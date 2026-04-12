//! Runtime evidence pack 导出服务
//!
//! 将当前 Lime 会话的 runtime / timeline / artifact 事实，
//! 导出为最小可复盘的问题证据包。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use crate::services::artifact_document_validator::ARTIFACT_DOCUMENT_SCHEMA_VERSION;
use chrono::Utc;
use lime_core::database::dao::agent_timeline::AgentThreadItemPayload;
use lime_infra::telemetry::RequestLog;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

const SESSION_RELATIVE_ROOT: &str = ".lime/harness/sessions";
const EVIDENCE_DIR_NAME: &str = "evidence";
const SUMMARY_FILE_NAME: &str = "summary.md";
const RUNTIME_FILE_NAME: &str = "runtime.json";
const TIMELINE_FILE_NAME: &str = "timeline.json";
const ARTIFACTS_FILE_NAME: &str = "artifacts.json";
const MAX_RECENT_ARTIFACTS: usize = 12;
const MAX_PREVIEW_CHARS: usize = 200;
const MAX_BROWSER_EVIDENCE_ITEMS: usize = 6;
const MAX_REQUEST_TELEMETRY_ITEMS: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeEvidenceArtifactKind {
    Summary,
    Runtime,
    Timeline,
    Artifacts,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEvidenceArtifact {
    pub kind: RuntimeEvidenceArtifactKind,
    pub title: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEvidencePackExportResult {
    pub session_id: String,
    pub thread_id: String,
    pub workspace_id: Option<String>,
    pub workspace_root: String,
    pub pack_relative_root: String,
    pub pack_absolute_root: String,
    pub exported_at: String,
    pub thread_status: String,
    pub latest_turn_status: Option<String>,
    pub turn_count: usize,
    pub item_count: usize,
    pub pending_request_count: usize,
    pub queued_turn_count: usize,
    pub recent_artifact_count: usize,
    pub known_gaps: Vec<String>,
    pub artifacts: Vec<RuntimeEvidenceArtifact>,
}

#[derive(Debug, Clone, PartialEq)]
struct RuntimeRecentArtifact {
    path: String,
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct RuntimeArtifactValidatorSummary {
    applicable: bool,
    records: Vec<Value>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct RuntimeEvidenceVerificationSummary {
    artifact_validator: RuntimeArtifactValidatorSummary,
    browser_evidence: Vec<Value>,
    gui_smoke: Option<Value>,
}

#[derive(Debug, Clone, Default)]
struct RuntimeRequestTelemetrySummary {
    searched_roots: Vec<String>,
    matched_request_count: usize,
    latest_request_at: Option<String>,
    status_counts: BTreeMap<String, usize>,
    providers: Vec<String>,
    models: Vec<String>,
    requests: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeEvidenceSignalCoverageEntry {
    signal: &'static str,
    status: &'static str,
    source: &'static str,
    detail: String,
}

pub fn export_runtime_evidence_pack(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: &Path,
) -> Result<RuntimeEvidencePackExportResult, String> {
    let session_id = detail.id.trim();
    if session_id.is_empty() {
        return Err("session_id 不能为空，无法导出问题证据包".to_string());
    }

    let thread_id = detail.thread_id.trim();
    if thread_id.is_empty() {
        return Err("thread_id 不能为空，无法导出问题证据包".to_string());
    }

    let workspace_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let exported_at = Utc::now().to_rfc3339();
    let pack_relative_root = format!("{SESSION_RELATIVE_ROOT}/{session_id}/{EVIDENCE_DIR_NAME}");
    let pack_absolute_root =
        workspace_root.join(pack_relative_root.replace('/', std::path::MAIN_SEPARATOR_STR));

    fs::create_dir_all(&pack_absolute_root).map_err(|error| {
        format!(
            "创建 evidence pack 目录失败 {}: {error}",
            pack_absolute_root.display()
        )
    })?;

    let recent_artifacts = collect_recent_artifacts(detail);
    let recent_artifact_paths = recent_artifacts
        .iter()
        .map(|artifact| artifact.path.clone())
        .collect::<Vec<_>>();
    let latest_turn_summary = collect_latest_turn_summary(detail);
    let request_telemetry = collect_request_telemetry(detail, workspace_root.as_path());
    let verification =
        collect_runtime_verification(detail, workspace_root.as_path(), &recent_artifacts);
    let signal_coverage = build_signal_coverage(
        thread_read,
        &recent_artifacts,
        &request_telemetry,
        &verification,
    );
    let known_gaps = build_known_gaps(&recent_artifacts, &signal_coverage);
    let observability_summary = build_runtime_observability_summary_json(
        detail,
        thread_read,
        &recent_artifact_paths,
        &request_telemetry,
        &verification,
        &signal_coverage,
        &known_gaps,
    );

    let artifacts = vec![
        write_evidence_file(
            &pack_absolute_root,
            session_id,
            SUMMARY_FILE_NAME,
            RuntimeEvidenceArtifactKind::Summary,
            "问题摘要",
            build_summary_markdown(
                detail,
                thread_read,
                &recent_artifact_paths,
                latest_turn_summary.as_deref(),
                &observability_summary,
                &known_gaps,
                exported_at.as_str(),
            ),
        )?,
        write_evidence_file(
            &pack_absolute_root,
            session_id,
            RUNTIME_FILE_NAME,
            RuntimeEvidenceArtifactKind::Runtime,
            "运行时快照",
            build_runtime_json(
                detail,
                thread_read,
                workspace_root.as_path(),
                &recent_artifact_paths,
                &observability_summary,
                &known_gaps,
                exported_at.as_str(),
            )?,
        )?,
        write_evidence_file(
            &pack_absolute_root,
            session_id,
            TIMELINE_FILE_NAME,
            RuntimeEvidenceArtifactKind::Timeline,
            "时间线快照",
            build_timeline_json(detail, exported_at.as_str())?,
        )?,
        write_evidence_file(
            &pack_absolute_root,
            session_id,
            ARTIFACTS_FILE_NAME,
            RuntimeEvidenceArtifactKind::Artifacts,
            "产物与验证线索",
            build_artifacts_json(
                detail,
                thread_read,
                &recent_artifact_paths,
                &observability_summary,
                &request_telemetry,
                &verification,
                &known_gaps,
                exported_at.as_str(),
            )?,
        )?,
    ];

    Ok(RuntimeEvidencePackExportResult {
        session_id: session_id.to_string(),
        thread_id: thread_id.to_string(),
        workspace_id: normalize_optional_text(detail.workspace_id.clone()),
        workspace_root: workspace_root.to_string_lossy().to_string(),
        pack_relative_root,
        pack_absolute_root: pack_absolute_root.to_string_lossy().to_string(),
        exported_at,
        thread_status: thread_read.status.trim().to_string(),
        latest_turn_status: thread_read
            .diagnostics
            .as_ref()
            .and_then(|value| normalize_optional_text(value.latest_turn_status.clone())),
        turn_count: detail.turns.len(),
        item_count: detail.items.len(),
        pending_request_count: thread_read.pending_requests.len(),
        queued_turn_count: thread_read.queued_turns.len(),
        recent_artifact_count: recent_artifact_paths.len(),
        known_gaps,
        artifacts,
    })
}

fn write_evidence_file(
    pack_root: &Path,
    session_id: &str,
    file_name: &str,
    kind: RuntimeEvidenceArtifactKind,
    title: &str,
    content: String,
) -> Result<RuntimeEvidenceArtifact, String> {
    let absolute_path = pack_root.join(file_name);
    fs::write(&absolute_path, content.as_bytes()).map_err(|error| {
        format!(
            "写入 evidence pack 文件失败 {}: {error}",
            absolute_path.display()
        )
    })?;

    Ok(RuntimeEvidenceArtifact {
        kind,
        title: title.to_string(),
        relative_path: format!(
            "{SESSION_RELATIVE_ROOT}/{session_id}/{EVIDENCE_DIR_NAME}/{file_name}"
        ),
        absolute_path: absolute_path.to_string_lossy().to_string(),
        bytes: content.len(),
    })
}

fn build_summary_markdown(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    recent_artifacts: &[String],
    latest_turn_summary: Option<&str>,
    observability_summary: &Value,
    known_gaps: &[String],
    exported_at: &str,
) -> String {
    let mut markdown = String::new();
    let _ = writeln!(markdown, "# 问题证据包");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "> 当前证据包继续沿用 Codex 的结构化交接思路，运行时事实承接 Aster 的 session / thread / diagnostics，最终制品由 Lime 落盘到工作区。"
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 会话：`{}`", detail.id);
    let _ = writeln!(markdown, "- 线程：`{}`", detail.thread_id);
    let _ = writeln!(markdown, "- 导出时间：{exported_at}");
    let _ = writeln!(markdown, "- 线程状态：{}", thread_read.status);
    let _ = writeln!(
        markdown,
        "- Pending request：{} · 排队 turn：{}",
        thread_read.pending_requests.len(),
        thread_read.queued_turns.len()
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 最近摘要");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "{}",
        latest_turn_summary
            .unwrap_or("当前没有结构化 turn summary，请先读 runtime.json 与 timeline.json。")
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 证据概览");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- Turns：{}", detail.turns.len());
    let _ = writeln!(markdown, "- Timeline items：{}", detail.items.len());
    let _ = writeln!(markdown, "- 最近产物：{}", recent_artifacts.len());
    if let Some(blocking_summary) = thread_read
        .diagnostics
        .as_ref()
        .and_then(|value| value.primary_blocking_summary.clone())
    {
        let _ = writeln!(markdown, "- 当前主要阻塞：{blocking_summary}");
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 证据关联与可观测覆盖");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "- 关联键：{}",
        observability_summary
            .pointer("/correlation/correlationKeys")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|value| format!("`{value}`"))
                    .collect::<Vec<_>>()
                    .join("、")
            })
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "当前未导出关联键".to_string())
    );
    let _ = writeln!(
        markdown,
        "- 当前导出信号：{}",
        format_observability_signal_list(observability_summary, "exported")
    );
    let _ = writeln!(
        markdown,
        "- 当前证据缺口：{}",
        format_observability_gap_list(observability_summary)
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 建议读取顺序");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "1. 先读 `summary.md`，确认会话状态和当前阻塞。");
    let _ = writeln!(
        markdown,
        "2. 再读 `runtime.json`，查看 pending request / queued turn / diagnostics。"
    );
    let _ = writeln!(
        markdown,
        "3. 再读 `timeline.json`，回放最近 turns 与 items。"
    );
    let _ = writeln!(
        markdown,
        "4. 最后读 `artifacts.json`，确认最近产物与当前证据缺口。"
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 已知缺口");
    let _ = writeln!(markdown);
    for gap in known_gaps {
        let _ = writeln!(markdown, "- {gap}");
    }

    markdown
}

fn build_runtime_json(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: &Path,
    recent_artifacts: &[String],
    observability_summary: &Value,
    known_gaps: &[String],
    exported_at: &str,
) -> Result<String, String> {
    let payload = json!({
        "schemaVersion": "v1",
        "source": {
            "contractShape": "codex_trace_evidence_pack",
            "runtimeSubstrate": "aster_session_thread_runtime",
            "productSurface": "lime_workspace_evidence_pack"
        },
        "session": {
            "sessionId": detail.id,
            "threadId": detail.thread_id,
            "name": detail.name,
            "workspaceId": detail.workspace_id,
            "workspaceRoot": workspace_root.to_string_lossy().to_string(),
            "exportedAt": exported_at,
            "updatedAt": detail.updated_at,
            "executionStrategy": detail.execution_strategy,
            "model": detail.model
        },
        "thread": {
            "status": thread_read.status,
            "activeTurnId": thread_read.active_turn_id,
            "interruptState": thread_read.interrupt_state,
            "latestTurnStatus": thread_read.diagnostics.as_ref().and_then(|value| value.latest_turn_status.clone()),
            "pendingRequestCount": thread_read.pending_requests.len(),
            "queuedTurnCount": thread_read.queued_turns.len(),
            "diagnostics": {
                "warningCount": thread_read.diagnostics.as_ref().map(|value| value.warning_count).unwrap_or(0),
                "contextCompactionCount": thread_read.diagnostics.as_ref().map(|value| value.context_compaction_count).unwrap_or(0),
                "failedToolCallCount": thread_read.diagnostics.as_ref().map(|value| value.failed_tool_call_count).unwrap_or(0),
                "failedCommandCount": thread_read.diagnostics.as_ref().map(|value| value.failed_command_count).unwrap_or(0),
                "primaryBlockingKind": thread_read.diagnostics.as_ref().and_then(|value| value.primary_blocking_kind.clone()),
                "primaryBlockingSummary": thread_read.diagnostics.as_ref().and_then(|value| value.primary_blocking_summary.clone()),
                "latestWarning": thread_read.diagnostics.as_ref().and_then(|value| value.latest_warning.as_ref().map(|warning| json!({
                    "code": warning.code,
                    "message": warning.message,
                    "updatedAt": warning.updated_at
                }))),
                "latestFailedTool": thread_read.diagnostics.as_ref().and_then(|value| value.latest_failed_tool.as_ref().map(|tool| json!({
                    "toolName": tool.tool_name,
                    "error": tool.error,
                    "updatedAt": tool.updated_at
                }))),
                "latestFailedCommand": thread_read.diagnostics.as_ref().and_then(|value| value.latest_failed_command.as_ref().map(|command| json!({
                    "command": command.command,
                    "exitCode": command.exit_code,
                    "error": command.error,
                    "updatedAt": command.updated_at
                })))
            }
        },
        "pendingRequests": thread_read.pending_requests.iter().map(|item| {
            json!({
                "id": item.id,
                "type": item.request_type,
                "status": item.status,
                "title": item.title,
                "turnId": item.turn_id
            })
        }).collect::<Vec<_>>(),
        "queuedTurns": thread_read.queued_turns.iter().map(|item| {
            json!({
                "id": item.queued_turn_id,
                "position": item.position,
                "preview": item.message_preview,
                "createdAt": item.created_at
            })
        }).collect::<Vec<_>>(),
        "subagents": detail.child_subagent_sessions.iter().map(|session| {
            json!({
                "id": session.id,
                "name": session.name,
                "runtimeStatus": session.runtime_status,
                "latestTurnStatus": session.latest_turn_status,
                "taskSummary": session.task_summary,
                "roleHint": session.role_hint,
                "updatedAt": session.updated_at
            })
        }).collect::<Vec<_>>(),
        "observabilitySummary": observability_summary,
        "recentArtifacts": recent_artifacts,
        "knownGaps": known_gaps
    });

    serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 runtime.json 失败: {error}"))
}

fn build_timeline_json(detail: &SessionDetail, exported_at: &str) -> Result<String, String> {
    let payload = json!({
        "schemaVersion": "v1",
        "exportedAt": exported_at,
        "turns": detail.turns.iter().map(|turn| {
            json!({
                "id": turn.id,
                "status": serialize_enum_as_string(&turn.status, "unknown"),
                "promptPreview": truncate_text(turn.prompt_text.as_str()),
                "startedAt": turn.started_at,
                "completedAt": turn.completed_at,
                "updatedAt": turn.updated_at
            })
        }).collect::<Vec<_>>(),
        "items": detail.items.iter().map(|item| {
            let (payload_kind, payload_summary) = summarize_item_payload(&item.payload);
            json!({
                "id": item.id,
                "turnId": item.turn_id,
                "sequence": item.sequence,
                "status": serialize_enum_as_string(&item.status, "unknown"),
                "payloadKind": payload_kind,
                "payloadSummary": payload_summary,
                "updatedAt": item.updated_at
            })
        }).collect::<Vec<_>>()
    });

    serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 timeline.json 失败: {error}"))
}

fn build_artifacts_json(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    recent_artifacts: &[String],
    observability_summary: &Value,
    request_telemetry: &RuntimeRequestTelemetrySummary,
    verification: &RuntimeEvidenceVerificationSummary,
    known_gaps: &[String],
    exported_at: &str,
) -> Result<String, String> {
    let mut payload = json!({
        "schemaVersion": "v1",
        "exportedAt": exported_at,
        "recentArtifacts": recent_artifacts,
        "artifactCount": recent_artifacts.len(),
        "observabilitySummary": observability_summary,
        "requests": {
            "pending": thread_read.pending_requests.iter().map(|item| {
                json!({
                    "id": item.id,
                    "type": item.request_type,
                    "title": item.title,
                    "status": item.status
                })
            }).collect::<Vec<_>>(),
            "telemetry": build_request_telemetry_json(request_telemetry)
        },
        "workspace": {
            "workspaceId": detail.workspace_id,
            "workingDir": detail.working_dir
        },
        "knownGaps": known_gaps
    });

    if let Some(verification_payload) = build_verification_json(verification) {
        payload
            .as_object_mut()
            .expect("artifacts payload must be object")
            .insert(
                "verification".to_string(),
                Value::Object(verification_payload),
            );
    }

    serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 artifacts.json 失败: {error}"))
}

fn build_known_gaps(
    recent_artifacts: &[RuntimeRecentArtifact],
    signal_coverage: &[RuntimeEvidenceSignalCoverageEntry],
) -> Vec<String> {
    let mut gaps = signal_coverage
        .iter()
        .filter(|entry| entry.status != "exported")
        .map(|entry| entry.detail.clone())
        .collect::<Vec<_>>();

    if recent_artifacts.is_empty() {
        gaps.push("当前未检测到最近产物路径，Artifact 证据为空。".to_string());
    }

    gaps.dedup();
    gaps
}

fn collect_latest_turn_summary(detail: &SessionDetail) -> Option<String> {
    detail
        .items
        .iter()
        .rev()
        .find_map(|item| match &item.payload {
            AgentThreadItemPayload::TurnSummary { text } => {
                normalize_optional_text(Some(text.clone()))
            }
            _ => None,
        })
}

fn collect_recent_artifacts(detail: &SessionDetail) -> Vec<RuntimeRecentArtifact> {
    let mut seen = std::collections::HashSet::new();
    let mut artifacts = Vec::new();

    for item in detail.items.iter().rev() {
        let Some((path, metadata)) = (match &item.payload {
            AgentThreadItemPayload::FileArtifact { path, metadata, .. } => {
                normalize_optional_text(Some(path.clone()))
                    .map(|normalized| (normalized, metadata.clone()))
            }
            _ => None,
        }) else {
            continue;
        };

        if seen.insert(path.clone()) {
            artifacts.push(RuntimeRecentArtifact { path, metadata });
        }
        if artifacts.len() >= MAX_RECENT_ARTIFACTS {
            break;
        }
    }

    artifacts
}

fn collect_request_telemetry(
    detail: &SessionDetail,
    workspace_root: &Path,
) -> RuntimeRequestTelemetrySummary {
    let turn_ids = detail
        .turns
        .iter()
        .map(|turn| turn.id.clone())
        .collect::<HashSet<_>>();
    let mut matched_logs = Vec::new();
    let searched_roots = candidate_request_log_roots(workspace_root)
        .into_iter()
        .filter(|root| root.is_dir())
        .map(|root| {
            for path in list_request_log_files(root.as_path()) {
                if let Ok(raw) = fs::read_to_string(&path) {
                    for line in raw.lines() {
                        if line.trim().is_empty() {
                            continue;
                        }
                        let Ok(log) = serde_json::from_str::<RequestLog>(line) else {
                            continue;
                        };
                        if request_log_matches_session(
                            &log,
                            detail.id.as_str(),
                            detail.thread_id.as_str(),
                            &turn_ids,
                        ) {
                            matched_logs.push(log);
                        }
                    }
                }
            }
            root.to_string_lossy().to_string()
        })
        .collect::<Vec<_>>();

    matched_logs.sort_by(|left, right| {
        right
            .timestamp
            .cmp(&left.timestamp)
            .then_with(|| right.id.cmp(&left.id))
    });

    let mut status_counts = BTreeMap::new();
    let mut providers = BTreeSet::new();
    let mut models = BTreeSet::new();
    for log in &matched_logs {
        *status_counts.entry(log.status.to_string()).or_insert(0) += 1;
        providers.insert(log.provider.to_string());
        models.insert(log.model.clone());
    }

    RuntimeRequestTelemetrySummary {
        searched_roots,
        matched_request_count: matched_logs.len(),
        latest_request_at: matched_logs.first().map(|log| log.timestamp.to_rfc3339()),
        status_counts,
        providers: providers.into_iter().collect(),
        models: models.into_iter().collect(),
        requests: matched_logs
            .into_iter()
            .take(MAX_REQUEST_TELEMETRY_ITEMS)
            .map(request_log_to_json)
            .collect(),
    }
}

fn candidate_request_log_roots(workspace_root: &Path) -> Vec<PathBuf> {
    let workspace_roots = [
        workspace_root.join("request_logs"),
        workspace_root.join(".lime/request_logs"),
    ]
    .into_iter()
    .filter(|candidate| candidate.is_dir())
    .collect::<Vec<_>>();

    if !workspace_roots.is_empty() {
        return workspace_roots;
    }

    let mut roots = Vec::new();
    let mut seen = HashSet::new();

    if let Ok(app_root) = lime_core::app_paths::resolve_request_logs_dir() {
        let key = app_root.to_string_lossy().to_string();
        if seen.insert(key) {
            roots.push(app_root);
        }
    }

    roots
}

fn list_request_log_files(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };

    let mut files = entries
        .filter_map(|entry| entry.ok().map(|value| value.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .collect::<Vec<_>>();
    files.sort_by(|left, right| right.cmp(left));
    files
}

fn request_log_matches_session(
    log: &RequestLog,
    session_id: &str,
    thread_id: &str,
    turn_ids: &HashSet<String>,
) -> bool {
    if log.session_id.as_deref() != Some(session_id) {
        return false;
    }
    if log.thread_id.as_deref() != Some(thread_id) {
        return false;
    }

    match log.turn_id.as_deref() {
        Some(turn_id) if !turn_ids.is_empty() => turn_ids.contains(turn_id),
        _ => true,
    }
}

fn request_log_to_json(log: RequestLog) -> Value {
    json!({
        "id": log.id,
        "timestamp": log.timestamp.to_rfc3339(),
        "provider": log.provider.to_string(),
        "model": log.model,
        "status": log.status.to_string(),
        "durationMs": log.duration_ms,
        "httpStatus": log.http_status,
        "isStreaming": log.is_streaming,
        "credentialId": log.credential_id,
        "retryCount": log.retry_count,
        "inputTokens": log.input_tokens,
        "outputTokens": log.output_tokens,
        "totalTokens": log.total_tokens,
        "errorMessage": log.error_message,
        "sessionId": log.session_id,
        "threadId": log.thread_id,
        "turnId": log.turn_id,
        "pendingRequestId": log.pending_request_id,
        "queuedTurnId": log.queued_turn_id,
        "subagentSessionId": log.subagent_session_id
    })
}

fn build_request_telemetry_json(summary: &RuntimeRequestTelemetrySummary) -> Value {
    json!({
        "source": "lime_infra.telemetry.request_logs",
        "searchedRoots": summary.searched_roots,
        "matchedRequestCount": summary.matched_request_count,
        "latestRequestAt": summary.latest_request_at,
        "statusCounts": summary.status_counts,
        "providers": summary.providers,
        "models": summary.models,
        "requests": summary.requests
    })
}

fn summarize_item_payload(payload: &AgentThreadItemPayload) -> (&'static str, Option<String>) {
    match payload {
        AgentThreadItemPayload::Plan { text } => {
            ("plan", normalize_optional_text(Some(truncate_text(text))))
        }
        AgentThreadItemPayload::TurnSummary { text } => (
            "turn_summary",
            normalize_optional_text(Some(truncate_text(text))),
        ),
        AgentThreadItemPayload::FileArtifact { path, .. } => {
            ("file_artifact", normalize_optional_text(Some(path.clone())))
        }
        _ => ("other", None),
    }
}

fn truncate_text(value: &str) -> String {
    let normalized = value.trim();
    if normalized.chars().count() <= MAX_PREVIEW_CHARS {
        return normalized.to_string();
    }

    normalized
        .chars()
        .take(MAX_PREVIEW_CHARS)
        .collect::<String>()
        + "..."
}

fn build_runtime_observability_summary_json(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    recent_artifacts: &[String],
    request_telemetry: &RuntimeRequestTelemetrySummary,
    verification: &RuntimeEvidenceVerificationSummary,
    signal_coverage: &[RuntimeEvidenceSignalCoverageEntry],
    known_gaps: &[String],
) -> Value {
    let diagnostics = thread_read.diagnostics.as_ref();
    let mut payload = json!({
        "schemaVersion": "v1",
        "correlation": {
            "correlationKeys": [
                "session_id",
                "thread_id",
                "turn_id",
                "pending_request_id",
                "queued_turn_id",
                "subagent_session_id"
            ],
            "sessionId": detail.id,
            "threadId": detail.thread_id,
            "activeTurnId": thread_read.active_turn_id,
            "pendingRequestIds": thread_read.pending_requests.iter().map(|item| item.id.clone()).collect::<Vec<_>>(),
            "queuedTurnIds": thread_read.queued_turns.iter().map(|item| item.queued_turn_id.clone()).collect::<Vec<_>>(),
            "subagentSessionIds": detail.child_subagent_sessions.iter().map(|item| item.id.clone()).collect::<Vec<_>>()
        },
        "counts": {
            "turnCount": detail.turns.len(),
            "itemCount": detail.items.len(),
            "pendingRequestCount": thread_read.pending_requests.len(),
            "queuedTurnCount": thread_read.queued_turns.len(),
            "warningCount": diagnostics.map(|value| value.warning_count).unwrap_or(0),
            "failedToolCallCount": diagnostics.map(|value| value.failed_tool_call_count).unwrap_or(0),
            "failedCommandCount": diagnostics.map(|value| value.failed_command_count).unwrap_or(0),
            "subagentCount": detail.child_subagent_sessions.len(),
            "recentArtifactCount": recent_artifacts.len()
        },
        "latest": {
            "warning": latest_warning_json(diagnostics),
            "failedTool": latest_failed_tool_json(diagnostics),
            "failedCommand": latest_failed_command_json(diagnostics)
        },
        "requestTelemetry": build_request_telemetry_json(request_telemetry),
        "signalCoverage": signal_coverage.iter().map(|entry| json!({
            "signal": entry.signal,
            "status": entry.status,
            "source": entry.source,
            "detail": entry.detail
        })).collect::<Vec<_>>(),
        "knownGaps": known_gaps
    });

    if let Some(verification_summary) = build_observability_verification_summary_json(verification)
    {
        payload
            .as_object_mut()
            .expect("observability summary must be object")
            .insert("verificationSummary".to_string(), verification_summary);
    }

    payload
}

fn collect_runtime_verification(
    detail: &SessionDetail,
    workspace_root: &Path,
    recent_artifacts: &[RuntimeRecentArtifact],
) -> RuntimeEvidenceVerificationSummary {
    RuntimeEvidenceVerificationSummary {
        artifact_validator: collect_artifact_validator_summary(workspace_root, recent_artifacts),
        browser_evidence: collect_browser_evidence(detail),
        gui_smoke: collect_gui_smoke_result(detail),
    }
}

fn collect_artifact_validator_summary(
    workspace_root: &Path,
    recent_artifacts: &[RuntimeRecentArtifact],
) -> RuntimeArtifactValidatorSummary {
    let mut summary = RuntimeArtifactValidatorSummary::default();

    for artifact in recent_artifacts {
        let mut applicable = is_artifact_validator_applicable(artifact);
        let mut candidates = Vec::new();

        if let Some(metadata) = artifact.metadata.as_ref() {
            candidates.push(metadata.clone());
            if let Some(document) = metadata.get("artifactDocument") {
                candidates.push(document.clone());
            }
        }

        if artifact.path.ends_with(".artifact.json") {
            applicable = true;
            let absolute_path = resolve_workspace_path(workspace_root, artifact.path.as_str());
            if let Ok(raw) = fs::read_to_string(&absolute_path) {
                if let Ok(document) = serde_json::from_str::<Value>(raw.as_str()) {
                    candidates.push(document);
                }
            }
        }

        summary.applicable |= applicable;

        for candidate in candidates {
            if let Some(record) =
                extract_artifact_validator_record(candidate, artifact.path.as_str())
            {
                summary.records.push(record);
                break;
            }
        }
    }

    summary
}

fn collect_browser_evidence(detail: &SessionDetail) -> Vec<Value> {
    let mut evidence = Vec::new();

    for item in detail.items.iter().rev() {
        let record = match &item.payload {
            AgentThreadItemPayload::ToolCall {
                tool_name,
                success,
                error,
                ..
            } if is_browser_tool_name(tool_name.as_str()) => Some(json!({
                "kind": "tool_call",
                "itemId": item.id,
                "turnId": item.turn_id,
                "toolName": tool_name,
                "success": success,
                "error": error,
                "updatedAt": item.updated_at
            })),
            AgentThreadItemPayload::CommandExecution {
                command,
                exit_code,
                error,
                ..
            } if is_browser_command(command.as_str()) => Some(json!({
                "kind": "command_execution",
                "itemId": item.id,
                "turnId": item.turn_id,
                "command": command,
                "exitCode": exit_code,
                "error": error,
                "updatedAt": item.updated_at
            })),
            _ => None,
        };

        if let Some(record) = record {
            evidence.push(record);
        }
        if evidence.len() >= MAX_BROWSER_EVIDENCE_ITEMS {
            break;
        }
    }

    evidence.reverse();
    evidence
}

fn collect_gui_smoke_result(detail: &SessionDetail) -> Option<Value> {
    detail
        .items
        .iter()
        .rev()
        .find_map(|item| match &item.payload {
            AgentThreadItemPayload::CommandExecution {
                command,
                cwd,
                aggregated_output,
                exit_code,
                error,
            } if is_gui_smoke_command(command.as_str()) => Some(json!({
                "itemId": item.id,
                "turnId": item.turn_id,
                "status": item.status.as_str(),
                "command": command,
                "cwd": cwd,
                "exitCode": exit_code,
                "error": error,
                "updatedAt": item.updated_at,
                "outputPreview": aggregated_output
                    .as_ref()
                    .map(|value| truncate_text(value.as_str()))
            })),
            _ => None,
        })
}

fn build_signal_coverage(
    thread_read: &AgentRuntimeThreadReadModel,
    recent_artifacts: &[RuntimeRecentArtifact],
    request_telemetry: &RuntimeRequestTelemetrySummary,
    verification: &RuntimeEvidenceVerificationSummary,
) -> Vec<RuntimeEvidenceSignalCoverageEntry> {
    let diagnostics = thread_read.diagnostics.as_ref();
    let request_telemetry_entry = if request_telemetry.searched_roots.is_empty() {
        RuntimeEvidenceSignalCoverageEntry {
            signal: "requestTelemetry",
            status: "known_gap",
            source: "lime_infra.telemetry.request_logs",
            detail: "当前环境未找到可读取的 request telemetry 日志目录，Evidence Pack 无法导出会话级请求遥测。".to_string(),
        }
    } else if request_telemetry.matched_request_count == 0 {
        RuntimeEvidenceSignalCoverageEntry {
            signal: "requestTelemetry",
            status: "exported",
            source: "lime_infra.telemetry.request_logs",
            detail: "当前证据包已扫描 request telemetry 日志目录，但当前会话未匹配到 provider request 记录。".to_string(),
        }
    } else {
        RuntimeEvidenceSignalCoverageEntry {
            signal: "requestTelemetry",
            status: "exported",
            source: "lime_infra.telemetry.request_logs",
            detail: format!(
                "当前证据包已导出 {} 条按 session/thread/turn 关联的 request telemetry 记录。",
                request_telemetry.matched_request_count
            ),
        }
    };
    let mut coverage = vec![
        RuntimeEvidenceSignalCoverageEntry {
            signal: "correlation",
            status: "exported",
            source: "runtime thread identity",
            detail: "当前证据包已导出 session/thread/turn/pending request/subagent 关联键。"
                .to_string(),
        },
        RuntimeEvidenceSignalCoverageEntry {
            signal: "timeline",
            status: "exported",
            source: "timeline.json",
            detail: "当前证据包已导出最近 turn 与 item 时间线。".to_string(),
        },
        RuntimeEvidenceSignalCoverageEntry {
            signal: "warnings",
            status: "exported",
            source: "thread.diagnostics",
            detail: if diagnostics.is_some() {
                "当前证据包已导出 warning / failed tool / failed command 摘要。".to_string()
            } else {
                "当前线程没有 diagnostics，但 warning 通道已保留在导出结构中。".to_string()
            },
        },
        request_telemetry_entry,
    ];

    if verification.artifact_validator.applicable {
        coverage.push(RuntimeEvidenceSignalCoverageEntry {
            signal: "artifactValidator",
            status: if verification.artifact_validator.records.is_empty() {
                "known_gap"
            } else {
                "exported"
            },
            source: "artifact_document_validator",
            detail: if verification.artifact_validator.records.is_empty() {
                format!(
                    "当前检测到 {} 个 ArtifactDocument 产物，但 validator outcome 尚未回挂到当前 evidence pack。",
                    recent_artifacts
                        .iter()
                        .filter(|artifact| is_artifact_validator_applicable(artifact))
                        .count()
                )
            } else {
                format!(
                    "当前证据包已为 {} 个 ArtifactDocument 产物导出 validator outcome。",
                    verification.artifact_validator.records.len()
                )
            },
        });
    }

    if !verification.browser_evidence.is_empty() {
        coverage.push(RuntimeEvidenceSignalCoverageEntry {
            signal: "browserVerification",
            status: "exported",
            source: "browser runtime",
            detail: format!(
                "当前证据包已导出 {} 条浏览器验证线索。",
                verification.browser_evidence.len()
            ),
        });
    }

    if verification.gui_smoke.is_some() {
        coverage.push(RuntimeEvidenceSignalCoverageEntry {
            signal: "guiSmoke",
            status: "exported",
            source: "verify:gui-smoke",
            detail: "当前证据包已导出 GUI smoke 运行结果。".to_string(),
        });
    }

    coverage
}

fn build_verification_json(
    verification: &RuntimeEvidenceVerificationSummary,
) -> Option<Map<String, Value>> {
    let mut payload = Map::new();

    if verification.artifact_validator.applicable {
        payload.insert(
            "artifactValidatorIssues".to_string(),
            Value::Array(verification.artifact_validator.records.clone()),
        );
    }

    if !verification.browser_evidence.is_empty() {
        payload.insert(
            "browserEvidence".to_string(),
            Value::Array(verification.browser_evidence.clone()),
        );
    }

    if let Some(gui_smoke) = verification.gui_smoke.clone() {
        payload.insert("guiSmoke".to_string(), gui_smoke);
    }

    (!payload.is_empty()).then_some(payload)
}

fn build_observability_verification_summary_json(
    verification: &RuntimeEvidenceVerificationSummary,
) -> Option<Value> {
    let mut payload = Map::new();

    if verification.artifact_validator.applicable {
        let issue_count = verification
            .artifact_validator
            .records
            .iter()
            .map(|record| {
                record
                    .get("issues")
                    .and_then(Value::as_array)
                    .map(|issues| issues.len())
                    .unwrap_or(0)
            })
            .sum::<usize>();
        let repaired_count = verification
            .artifact_validator
            .records
            .iter()
            .filter(|record| {
                record
                    .get("repaired")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .count();
        let fallback_used_count = verification
            .artifact_validator
            .records
            .iter()
            .filter(|record| {
                record
                    .get("fallbackUsed")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .count();

        payload.insert(
            "artifactValidator".to_string(),
            json!({
                "applicable": true,
                "recordCount": verification.artifact_validator.records.len(),
                "issueCount": issue_count,
                "repairedCount": repaired_count,
                "fallbackUsedCount": fallback_used_count
            }),
        );
    }

    if !verification.browser_evidence.is_empty() {
        let mut success_count = 0usize;
        let mut failure_count = 0usize;
        let mut unknown_count = 0usize;
        let mut latest_updated_at: Option<String> = None;

        for record in &verification.browser_evidence {
            if let Some(updated_at) = record.get("updatedAt").and_then(Value::as_str) {
                if latest_updated_at
                    .as_ref()
                    .map(|current| updated_at > current.as_str())
                    .unwrap_or(true)
                {
                    latest_updated_at = Some(updated_at.to_string());
                }
            }

            match browser_evidence_record_outcome(record) {
                Some(true) => success_count += 1,
                Some(false) => failure_count += 1,
                None => unknown_count += 1,
            }
        }

        payload.insert(
            "browserVerification".to_string(),
            json!({
                "recordCount": verification.browser_evidence.len(),
                "successCount": success_count,
                "failureCount": failure_count,
                "unknownCount": unknown_count,
                "latestUpdatedAt": latest_updated_at
            }),
        );
    }

    if let Some(gui_smoke) = verification.gui_smoke.as_ref() {
        let exit_code = gui_smoke.get("exitCode").and_then(Value::as_i64);
        let has_error = gui_smoke
            .get("error")
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        let passed = exit_code == Some(0) && !has_error;

        payload.insert(
            "guiSmoke".to_string(),
            json!({
                "status": gui_smoke.get("status").cloned().unwrap_or(Value::Null),
                "exitCode": exit_code,
                "passed": passed,
                "updatedAt": gui_smoke.get("updatedAt").cloned().unwrap_or(Value::Null),
                "hasOutputPreview": gui_smoke.get("outputPreview").is_some()
            }),
        );
    }

    (!payload.is_empty()).then(|| Value::Object(payload))
}

fn browser_evidence_record_outcome(record: &Value) -> Option<bool> {
    if let Some(success) = record.get("success").and_then(Value::as_bool) {
        return Some(success);
    }

    if let Some(exit_code) = record.get("exitCode").and_then(Value::as_i64) {
        let has_error = record
            .get("error")
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        return Some(exit_code == 0 && !has_error);
    }

    None
}

fn is_artifact_validator_applicable(artifact: &RuntimeRecentArtifact) -> bool {
    artifact.path.ends_with(".artifact.json")
        || artifact
            .metadata
            .as_ref()
            .map(value_looks_like_artifact_document)
            .unwrap_or(false)
}

fn value_looks_like_artifact_document(value: &Value) -> bool {
    let Some(record) = value.as_object() else {
        return false;
    };

    record
        .get("schemaVersion")
        .and_then(Value::as_str)
        .map(str::trim)
        == Some(ARTIFACT_DOCUMENT_SCHEMA_VERSION)
        || record
            .get("artifactSchema")
            .and_then(Value::as_str)
            .map(str::trim)
            == Some(ARTIFACT_DOCUMENT_SCHEMA_VERSION)
        || record.get("artifactDocument").is_some()
        || record
            .get("metadata")
            .and_then(Value::as_object)
            .and_then(|metadata| metadata.get("artifactSchema"))
            .and_then(Value::as_str)
            .map(str::trim)
            == Some(ARTIFACT_DOCUMENT_SCHEMA_VERSION)
}

fn extract_artifact_validator_record(candidate: Value, path: &str) -> Option<Value> {
    let metadata = locate_artifact_validation_metadata(&candidate)?;
    let issues = metadata
        .get("artifactValidationIssues")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let repaired = metadata
        .get("artifactValidationRepaired")
        .and_then(Value::as_bool);
    let fallback_used = metadata
        .get("artifactFallbackUsed")
        .and_then(Value::as_bool);

    if issues.is_empty() && repaired.is_none() && fallback_used.is_none() {
        return None;
    }

    Some(json!({
        "path": path,
        "issues": issues,
        "repaired": repaired,
        "fallbackUsed": fallback_used
    }))
}

fn locate_artifact_validation_metadata(candidate: &Value) -> Option<&Map<String, Value>> {
    let record = candidate.as_object()?;
    if has_artifact_validation_fields(record) {
        return Some(record);
    }

    if let Some(metadata) = record.get("metadata").and_then(Value::as_object) {
        if has_artifact_validation_fields(metadata) {
            return Some(metadata);
        }
    }

    if let Some(document_metadata) = record
        .get("artifactDocument")
        .and_then(Value::as_object)
        .and_then(|document| document.get("metadata"))
        .and_then(Value::as_object)
    {
        if has_artifact_validation_fields(document_metadata) {
            return Some(document_metadata);
        }
    }

    None
}

fn has_artifact_validation_fields(record: &Map<String, Value>) -> bool {
    record.contains_key("artifactValidationIssues")
        || record.contains_key("artifactValidationRepaired")
        || record.contains_key("artifactFallbackUsed")
}

fn resolve_workspace_path(workspace_root: &Path, path: &str) -> PathBuf {
    let candidate = PathBuf::from(path);
    if candidate.is_absolute() {
        candidate
    } else {
        workspace_root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR))
    }
}

fn is_browser_tool_name(tool_name: &str) -> bool {
    let normalized = tool_name.trim().to_ascii_lowercase();
    normalized.contains("browser")
        || normalized.contains("playwright")
        || normalized.contains("chrome_devtools")
        || normalized.contains("cdp")
}

fn is_browser_command(command: &str) -> bool {
    let normalized = command.trim().to_ascii_lowercase();
    (normalized.contains("browser") || normalized.contains("playwright"))
        && !is_gui_smoke_command(command)
}

fn is_gui_smoke_command(command: &str) -> bool {
    let normalized = command.trim().to_ascii_lowercase();
    normalized.contains("verify:gui-smoke") || normalized.contains("verify-gui-smoke")
}

fn latest_warning_json(
    diagnostics: Option<&crate::commands::aster_agent_cmd::AgentRuntimeThreadDiagnostics>,
) -> Option<Value> {
    diagnostics.and_then(|value| {
        value.latest_warning.as_ref().map(|warning| {
            json!({
                "code": warning.code,
                "message": warning.message,
                "updatedAt": warning.updated_at
            })
        })
    })
}

fn latest_failed_tool_json(
    diagnostics: Option<&crate::commands::aster_agent_cmd::AgentRuntimeThreadDiagnostics>,
) -> Option<Value> {
    diagnostics.and_then(|value| {
        value.latest_failed_tool.as_ref().map(|tool| {
            json!({
                "toolName": tool.tool_name,
                "error": tool.error,
                "updatedAt": tool.updated_at
            })
        })
    })
}

fn latest_failed_command_json(
    diagnostics: Option<&crate::commands::aster_agent_cmd::AgentRuntimeThreadDiagnostics>,
) -> Option<Value> {
    diagnostics.and_then(|value| {
        value.latest_failed_command.as_ref().map(|command| {
            json!({
                "command": command.command,
                "exitCode": command.exit_code,
                "error": command.error,
                "updatedAt": command.updated_at
            })
        })
    })
}

fn format_observability_signal_list(observability_summary: &Value, status: &str) -> String {
    let signals = observability_summary
        .pointer("/signalCoverage")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter(|value| {
                    value
                        .get("status")
                        .and_then(Value::as_str)
                        .map(|value| value == status)
                        .unwrap_or(false)
                })
                .filter_map(|value| value.get("signal").and_then(Value::as_str))
                .map(|value| format!("`{value}`"))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if signals.is_empty() {
        "无".to_string()
    } else {
        signals.join("、")
    }
}

fn format_observability_gap_list(observability_summary: &Value) -> String {
    let signals = observability_summary
        .pointer("/signalCoverage")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| {
                    let signal = value.get("signal").and_then(Value::as_str)?;
                    let status = value.get("status").and_then(Value::as_str)?;
                    if status == "exported" {
                        return None;
                    }
                    Some(format!("`{signal}` ({status})"))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if signals.is_empty() {
        "无".to_string()
    } else {
        signals.join("、")
    }
}

fn serialize_enum_as_string<T: Serialize>(value: &T, fallback: &str) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|item| item.as_str().map(str::to_string))
        .unwrap_or_else(|| fallback.to_string())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::QueuedTurnSnapshot;
    use lime_core::database::dao::agent_timeline::{
        AgentThreadItem, AgentThreadItemPayload, AgentThreadItemStatus, AgentThreadTurn,
        AgentThreadTurnStatus,
    };
    use tempfile::TempDir;

    fn build_detail() -> SessionDetail {
        SessionDetail {
            id: "session-1".to_string(),
            name: "P2 evidence".to_string(),
            created_at: 1,
            updated_at: 2,
            thread_id: "thread-1".to_string(),
            model: Some("gpt-5.4".to_string()),
            working_dir: Some("/tmp/workspace".to_string()),
            workspace_id: Some("workspace-1".to_string()),
            messages: Vec::new(),
            execution_strategy: Some("react".to_string()),
            execution_runtime: None,
            turns: vec![AgentThreadTurn {
                id: "turn-1".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "继续推进 evidence pack".to_string(),
                status: AgentThreadTurnStatus::Completed,
                started_at: "2026-03-27T10:00:00Z".to_string(),
                completed_at: Some("2026-03-27T10:01:00Z".to_string()),
                error_message: None,
                created_at: "2026-03-27T10:00:00Z".to_string(),
                updated_at: "2026-03-27T10:01:00Z".to_string(),
            }],
            items: vec![
                AgentThreadItem {
                    id: "plan-1".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    sequence: 1,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-27T10:00:05Z".to_string(),
                    completed_at: Some("2026-03-27T10:00:05Z".to_string()),
                    updated_at: "2026-03-27T10:00:05Z".to_string(),
                    payload: AgentThreadItemPayload::Plan {
                        text: "先导出 handoff，再导出 evidence pack".to_string(),
                    },
                },
                AgentThreadItem {
                    id: "artifact-1".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    sequence: 2,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-27T10:00:20Z".to_string(),
                    completed_at: Some("2026-03-27T10:00:20Z".to_string()),
                    updated_at: "2026-03-27T10:00:20Z".to_string(),
                    payload: AgentThreadItemPayload::FileArtifact {
                        path: ".lime/artifacts/thread-1/report.md".to_string(),
                        source: "artifact_snapshot".to_string(),
                        content: None,
                        metadata: None,
                    },
                },
                AgentThreadItem {
                    id: "summary-1".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    sequence: 3,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-27T10:00:30Z".to_string(),
                    completed_at: Some("2026-03-27T10:00:30Z".to_string()),
                    updated_at: "2026-03-27T10:00:30Z".to_string(),
                    payload: AgentThreadItemPayload::TurnSummary {
                        text: "已拿到 handoff 四件套，下一步补问题证据包。".to_string(),
                    },
                },
            ],
            todo_items: Vec::new(),
            child_subagent_sessions: Vec::new(),
            subagent_parent_context: None,
        }
    }

    fn build_thread_read() -> AgentRuntimeThreadReadModel {
        AgentRuntimeThreadReadModel {
            thread_id: "thread-1".to_string(),
            status: "running".to_string(),
            active_turn_id: Some("turn-1".to_string()),
            pending_requests: vec![crate::commands::aster_agent_cmd::AgentRuntimeRequestView {
                id: "req-1".to_string(),
                thread_id: "thread-1".to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: None,
                request_type: "ask_user".to_string(),
                status: "pending".to_string(),
                title: Some("确认是否导出问题证据包".to_string()),
                payload: None,
                decision: None,
                scope: None,
                created_at: None,
                resolved_at: None,
            }],
            last_outcome: None,
            incidents: Vec::new(),
            queued_turns: vec![QueuedTurnSnapshot {
                queued_turn_id: "queued-1".to_string(),
                message_preview: "继续补证据包 UI".to_string(),
                message_text: "继续补证据包 UI".to_string(),
                created_at: 3,
                image_count: 0,
                position: 1,
            }],
            interrupt_state: None,
            updated_at: Some("2026-03-27T10:01:00Z".to_string()),
            latest_compaction_boundary: None,
            diagnostics: Some(
                crate::commands::aster_agent_cmd::AgentRuntimeThreadDiagnostics {
                    latest_turn_status: Some("running".to_string()),
                    latest_turn_started_at: None,
                    latest_turn_completed_at: None,
                    latest_turn_updated_at: None,
                    latest_turn_elapsed_seconds: None,
                    latest_turn_stalled_seconds: None,
                    latest_turn_error_message: None,
                    interrupt_reason: None,
                    runtime_interrupt_source: None,
                    runtime_interrupt_requested_at: None,
                    runtime_interrupt_wait_seconds: None,
                    warning_count: 1,
                    context_compaction_count: 0,
                    failed_tool_call_count: 0,
                    failed_command_count: 0,
                    pending_request_count: 1,
                    oldest_pending_request_wait_seconds: None,
                    primary_blocking_kind: Some("pending_request".to_string()),
                    primary_blocking_summary: Some("等待用户确认是否导出问题证据包".to_string()),
                    latest_warning: Some(
                        crate::commands::aster_agent_cmd::AgentRuntimeDiagnosticWarningSample {
                            item_id: "warning-1".to_string(),
                            turn_id: Some("turn-1".to_string()),
                            code: Some("runtime.pending".to_string()),
                            message: "存在待处理请求".to_string(),
                            updated_at: "2026-03-27T10:01:00Z".to_string(),
                        },
                    ),
                    latest_context_compaction: None,
                    latest_failed_tool: None,
                    latest_failed_command: None,
                    latest_pending_request: None,
                },
            ),
        }
    }

    fn write_request_telemetry_fixture(root: &Path) {
        let request_logs_dir = root.join("request_logs");
        fs::create_dir_all(&request_logs_dir).expect("create request logs dir");

        let mut log = RequestLog::new(
            "req-log-1".to_string(),
            lime_core::ProviderType::OpenAI,
            "gpt-5.4".to_string(),
            false,
        );
        log.session_id = Some("session-1".to_string());
        log.thread_id = Some("thread-1".to_string());
        log.turn_id = Some("turn-1".to_string());
        log.pending_request_id = Some("req-1".to_string());
        log.queued_turn_id = Some("queued-1".to_string());
        log.mark_success(420, 200);
        log.set_tokens(Some(128), Some(64));

        fs::write(
            request_logs_dir.join("requests_2026-03-27.jsonl"),
            format!(
                "{}\n",
                serde_json::to_string(&log).expect("serialize request log")
            ),
        )
        .expect("write request log");
    }

    fn write_unmatched_request_telemetry_fixture(root: &Path) {
        let request_logs_dir = root.join("request_logs");
        fs::create_dir_all(&request_logs_dir).expect("create request logs dir");

        let mut log = RequestLog::new(
            "req-log-unmatched".to_string(),
            lime_core::ProviderType::Anthropic,
            "claude-sonnet-4.5".to_string(),
            false,
        );
        log.session_id = Some("other-session".to_string());
        log.thread_id = Some("other-thread".to_string());
        log.turn_id = Some("other-turn".to_string());
        log.mark_success(180, 200);

        fs::write(
            request_logs_dir.join("requests_2026-03-28.jsonl"),
            format!(
                "{}\n",
                serde_json::to_string(&log).expect("serialize unmatched request log")
            ),
        )
        .expect("write unmatched request log");
    }

    #[test]
    fn should_export_runtime_evidence_pack_to_workspace() {
        let temp_dir = TempDir::new().expect("temp dir");
        let detail = build_detail();
        let thread_read = build_thread_read();
        write_request_telemetry_fixture(temp_dir.path());

        let result =
            export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        assert_eq!(
            result.pack_relative_root,
            ".lime/harness/sessions/session-1/evidence"
        );
        assert_eq!(result.artifacts.len(), 4);
        assert_eq!(result.turn_count, 1);
        assert_eq!(result.item_count, 3);
        assert_eq!(result.pending_request_count, 1);
        assert_eq!(result.queued_turn_count, 1);
        assert_eq!(result.recent_artifact_count, 1);
        assert!(result.known_gaps.is_empty());

        let summary_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/summary.md");
        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let timeline_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/timeline.json");
        let artifacts_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/artifacts.json");

        assert!(summary_path.exists());
        assert!(runtime_path.exists());
        assert!(timeline_path.exists());
        assert!(artifacts_path.exists());

        let summary = fs::read_to_string(summary_path).expect("summary");
        assert!(summary.contains("问题证据包"));
        assert!(summary.contains("等待用户确认是否导出问题证据包"));
        assert!(summary.contains("证据关联与可观测覆盖"));
        assert!(summary.contains("requestTelemetry"));
        assert!(!summary.contains("artifactValidator"));
        assert!(!summary.contains("browserVerification"));
        assert!(!summary.contains("guiSmoke"));

        let runtime = fs::read_to_string(runtime_path).expect("runtime");
        assert!(runtime.contains("\"sessionId\": \"session-1\""));
        assert!(runtime.contains("\"pendingRequestCount\": 1"));
        assert!(runtime.contains("\"observabilitySummary\""));
        assert!(runtime.contains("\"requestTelemetry\""));
        assert!(runtime.contains("\"matchedRequestCount\": 1"));
        assert!(!runtime.contains("\"verificationSummary\""));
        assert!(!runtime.contains("\"artifactValidator\""));
        assert!(!runtime.contains("\"browserVerification\""));
        assert!(!runtime.contains("\"guiSmoke\""));

        let timeline = fs::read_to_string(timeline_path).expect("timeline");
        assert!(timeline.contains("\"payloadKind\": \"plan\""));
        assert!(timeline.contains("\"status\": \"completed\""));

        let artifacts = fs::read_to_string(artifacts_path).expect("artifacts");
        assert!(artifacts.contains("\"observabilitySummary\""));
        assert!(artifacts.contains("\"telemetry\""));
        assert!(artifacts.contains("\"matchedRequestCount\": 1"));
        assert!(!artifacts.contains("\"verification\""));
    }

    #[test]
    fn should_export_runtime_verification_when_signal_is_applicable() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();
        write_request_telemetry_fixture(temp_dir.path());
        let artifact_relative_path = ".lime/artifacts/thread-1/report.artifact.json";
        let artifact_absolute_path = temp_dir
            .path()
            .join(artifact_relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));

        fs::create_dir_all(
            artifact_absolute_path
                .parent()
                .expect("artifact path should have parent"),
        )
        .expect("create artifact dir");
        fs::write(
            &artifact_absolute_path,
            serde_json::to_string_pretty(&json!({
                "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
                "title": "Harness Evidence",
                "kind": "analysis",
                "status": "ready",
                "blocks": [
                    {
                        "id": "block-1",
                        "type": "rich_text",
                        "content": "test"
                    }
                ],
                "metadata": {
                    "artifactValidationIssues": ["title 缺失或为空，已使用兜底标题。"],
                    "artifactValidationRepaired": true,
                    "artifactFallbackUsed": false
                }
            }))
            .expect("serialize artifact document"),
        )
        .expect("write artifact document");

        if let AgentThreadItemPayload::FileArtifact { path, .. } = &mut detail.items[1].payload {
            *path = artifact_relative_path.to_string();
        }

        detail.items.push(AgentThreadItem {
            id: "browser-tool-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:40Z".to_string(),
            completed_at: Some("2026-03-27T10:00:40Z".to_string()),
            updated_at: "2026-03-27T10:00:40Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "browser_snapshot".to_string(),
                arguments: None,
                output: None,
                success: Some(true),
                error: None,
                metadata: None,
            },
        });
        detail.items.push(AgentThreadItem {
            id: "gui-smoke-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 5,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:50Z".to_string(),
            completed_at: Some("2026-03-27T10:00:50Z".to_string()),
            updated_at: "2026-03-27T10:00:50Z".to_string(),
            payload: AgentThreadItemPayload::CommandExecution {
                command: "npm run verify:gui-smoke".to_string(),
                cwd: temp_dir.path().to_string_lossy().to_string(),
                aggregated_output: Some("GUI smoke finished successfully".to_string()),
                exit_code: Some(0),
                error: None,
            },
        });

        let result =
            export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        assert!(result
            .known_gaps
            .iter()
            .all(|gap| !gap.contains("ArtifactDocument")));

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let artifacts_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/artifacts.json");

        let runtime = fs::read_to_string(runtime_path).expect("runtime");
        assert!(runtime.contains("\"artifactValidator\""));
        assert!(runtime.contains("\"browserVerification\""));
        assert!(runtime.contains("\"guiSmoke\""));
        assert!(runtime.contains("\"status\": \"exported\""));
        assert!(runtime.contains("\"verificationSummary\""));
        assert!(runtime.contains("\"recordCount\": 1"));
        assert!(runtime.contains("\"issueCount\": 1"));
        assert!(runtime.contains("\"repairedCount\": 1"));
        assert!(runtime.contains("\"successCount\": 1"));
        assert!(runtime.contains("\"passed\": true"));

        let artifacts = fs::read_to_string(artifacts_path).expect("artifacts");
        assert!(artifacts.contains("\"verification\""));
        assert!(artifacts.contains("\"artifactValidatorIssues\""));
        assert!(artifacts.contains("\"browserEvidence\""));
        assert!(artifacts.contains("\"guiSmoke\""));
        assert!(artifacts.contains("title 缺失或为空"));
    }

    #[test]
    fn should_export_empty_request_telemetry_summary_when_no_request_matches_current_thread() {
        let temp_dir = TempDir::new().expect("temp dir");
        let detail = build_detail();
        let thread_read = build_thread_read();
        write_unmatched_request_telemetry_fixture(temp_dir.path());

        let result =
            export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        assert!(result
            .known_gaps
            .iter()
            .all(|gap| !gap.contains("request telemetry")));

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let artifacts_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/artifacts.json");

        let runtime = fs::read_to_string(runtime_path).expect("runtime");
        assert!(runtime.contains("\"requestTelemetry\""));
        assert!(runtime.contains("\"searchedRoots\": ["));
        assert!(runtime.contains("\"matchedRequestCount\": 0"));
        assert!(runtime.contains("\"providers\": []"));
        assert!(runtime.contains("\"models\": []"));
        assert!(runtime.contains("\"requests\": []"));
        assert!(runtime.contains("\"signal\": \"requestTelemetry\""));
        assert!(runtime.contains("\"status\": \"exported\""));
        assert!(runtime.contains("当前会话未匹配到 provider request 记录"));
        assert!(!runtime.contains("\"verificationSummary\""));

        let artifacts = fs::read_to_string(artifacts_path).expect("artifacts");
        assert!(artifacts.contains("\"telemetry\""));
        assert!(artifacts.contains("\"matchedRequestCount\": 0"));
    }
}
