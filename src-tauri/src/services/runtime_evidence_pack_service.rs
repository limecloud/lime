//! Runtime evidence pack 导出服务
//!
//! 将当前 Lime 会话的 runtime / timeline / artifact 事实，
//! 导出为最小可复盘的问题证据包。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use crate::commands::modality_runtime_contracts::{
    BROWSER_CONTROL_CONTRACT_KEY, BROWSER_CONTROL_ROUTING_SLOT, IMAGE_GENERATION_CONTRACT_KEY,
    IMAGE_GENERATION_ROUTING_SLOT, PDF_EXTRACT_CONTRACT_KEY, PDF_EXTRACT_ROUTING_SLOT,
    TEXT_TRANSFORM_CONTRACT_KEY, TEXT_TRANSFORM_ROUTING_SLOT, VOICE_GENERATION_CONTRACT_KEY,
    VOICE_GENERATION_ROUTING_SLOT, WEB_RESEARCH_CONTRACT_KEY, WEB_RESEARCH_ROUTING_SLOT,
};
use crate::database::DbConnection;
use crate::services::artifact_document_validator::ARTIFACT_DOCUMENT_SCHEMA_VERSION;
use crate::services::runtime_file_checkpoint_service::list_file_checkpoints;
use crate::services::workspace_health_service::ensure_workspace_ready_with_auto_relocate;
use crate::workspace::WorkspaceManager;
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub observability_summary: Value,
    pub artifacts: Vec<RuntimeEvidenceArtifact>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RuntimeEvidenceSceneAppSnapshot {
    pub recent_artifact_paths: Vec<String>,
    pub workspace_root: Option<String>,
    pub known_gaps: Vec<String>,
    pub verification_failure_outcomes: Vec<String>,
    pub request_telemetry_available: bool,
    pub request_telemetry_matched_count: usize,
    pub artifact_validator_applicable: bool,
    pub artifact_validator_issue_count: usize,
    pub artifact_validator_recovered_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeVerificationOutcome {
    Success,
    BlockingFailure,
    AdvisoryFailure,
    Recovered,
}

impl RuntimeVerificationOutcome {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::BlockingFailure => "blocking_failure",
            Self::AdvisoryFailure => "advisory_failure",
            Self::Recovered => "recovered",
        }
    }
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

#[derive(Debug, Clone, Default, PartialEq)]
struct RuntimeAuxiliaryRuntimeSnapshotSummary {
    applicable_count: usize,
    snapshots: Vec<Value>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct RuntimeModalityContractSnapshotSummary {
    applicable_count: usize,
    snapshots: Vec<Value>,
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
    let file_checkpoints = list_file_checkpoints(detail);
    let latest_turn_summary = collect_latest_turn_summary(detail);
    let request_telemetry = collect_request_telemetry(detail, workspace_root.as_path());
    let verification =
        collect_runtime_verification(detail, Some(workspace_root.as_path()), &recent_artifacts);
    let auxiliary_runtime =
        collect_auxiliary_runtime_snapshots(Some(workspace_root.as_path()), &recent_artifacts);
    let modality_runtime_contracts = collect_modality_runtime_contract_snapshots(
        detail,
        Some(workspace_root.as_path()),
        &recent_artifacts,
    );
    let signal_coverage = build_signal_coverage(
        thread_read,
        &recent_artifacts,
        &request_telemetry,
        &auxiliary_runtime,
        &modality_runtime_contracts,
        &verification,
    );
    let known_gaps = build_known_gaps(&recent_artifacts, &signal_coverage);
    let observability_summary = build_runtime_observability_summary_json(
        detail,
        thread_read,
        &recent_artifact_paths,
        &request_telemetry,
        &auxiliary_runtime,
        &modality_runtime_contracts,
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
                &file_checkpoints.checkpoints,
                &auxiliary_runtime,
                &modality_runtime_contracts,
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
                &file_checkpoints.checkpoints,
                &auxiliary_runtime,
                &modality_runtime_contracts,
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
        observability_summary,
        artifacts,
    })
}

pub(crate) fn resolve_runtime_export_workspace_root(
    db: &DbConnection,
    detail: &SessionDetail,
) -> Result<PathBuf, String> {
    if let Some(workspace_id) = detail
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let manager = WorkspaceManager::new(db.clone());
        let workspace_id = workspace_id.to_string();
        let workspace = manager
            .get(&workspace_id)
            .map_err(|error| format!("读取 workspace 失败: {error}"))?
            .ok_or_else(|| format!("Workspace 不存在: {workspace_id}"))?;
        let ensured = ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?;
        return Ok(ensured.root_path);
    }

    if let Some(working_dir) = detail
        .working_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(working_dir));
    }

    Err("当前会话缺少 workspace / working_dir，无法导出运行时制品".to_string())
}

pub(crate) fn build_runtime_evidence_sceneapp_snapshot(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: Option<&Path>,
) -> RuntimeEvidenceSceneAppSnapshot {
    let recent_artifacts = collect_recent_artifacts(detail);
    let request_telemetry = workspace_root
        .map(|root| collect_request_telemetry(detail, root))
        .unwrap_or_default();
    let auxiliary_runtime = collect_auxiliary_runtime_snapshots(workspace_root, &recent_artifacts);
    let modality_runtime_contracts =
        collect_modality_runtime_contract_snapshots(detail, workspace_root, &recent_artifacts);
    let verification = collect_runtime_verification(detail, workspace_root, &recent_artifacts);
    let signal_coverage = build_signal_coverage(
        thread_read,
        &recent_artifacts,
        &request_telemetry,
        &auxiliary_runtime,
        &modality_runtime_contracts,
        &verification,
    );
    let known_gaps = build_known_gaps(&recent_artifacts, &signal_coverage);

    RuntimeEvidenceSceneAppSnapshot {
        recent_artifact_paths: recent_artifacts
            .into_iter()
            .map(|artifact| artifact.path)
            .collect(),
        workspace_root: workspace_root.map(|path| path.to_string_lossy().to_string()),
        known_gaps,
        verification_failure_outcomes: extract_verification_failure_outcomes(&verification),
        request_telemetry_available: !request_telemetry.searched_roots.is_empty(),
        request_telemetry_matched_count: request_telemetry.matched_request_count,
        artifact_validator_applicable: verification.artifact_validator.applicable,
        artifact_validator_issue_count: verification
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
            .sum(),
        artifact_validator_recovered_count: verification
            .artifact_validator
            .records
            .iter()
            .filter(|record| {
                record
                    .get("repaired")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .count(),
    }
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
    file_checkpoints: &[crate::commands::aster_agent_cmd::AgentRuntimeFileCheckpointSummary],
    auxiliary_runtime: &RuntimeAuxiliaryRuntimeSnapshotSummary,
    modality_runtime_contracts: &RuntimeModalityContractSnapshotSummary,
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
            "runtimeFacts": build_thread_runtime_facts_json(thread_read),
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
        "auxiliaryRuntimeSnapshots": build_auxiliary_runtime_snapshots_json(auxiliary_runtime),
        "modalityRuntimeContracts": build_modality_runtime_contracts_json(modality_runtime_contracts),
        "recentArtifacts": recent_artifacts,
        "fileCheckpointCount": file_checkpoints.len(),
        "fileCheckpoints": file_checkpoints,
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
    file_checkpoints: &[crate::commands::aster_agent_cmd::AgentRuntimeFileCheckpointSummary],
    auxiliary_runtime: &RuntimeAuxiliaryRuntimeSnapshotSummary,
    modality_runtime_contracts: &RuntimeModalityContractSnapshotSummary,
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
        "fileCheckpointCount": file_checkpoints.len(),
        "fileCheckpoints": file_checkpoints,
        "auxiliaryRuntimeSnapshots": build_auxiliary_runtime_snapshots_json(auxiliary_runtime),
        "modalityRuntimeContracts": build_modality_runtime_contracts_json(modality_runtime_contracts),
        "observabilitySummary": observability_summary,
        "threadRuntimeFacts": build_thread_runtime_facts_json(thread_read),
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

fn build_auxiliary_runtime_snapshots_json(
    summary: &RuntimeAuxiliaryRuntimeSnapshotSummary,
) -> Value {
    json!({
        "applicableArtifactCount": summary.applicable_count,
        "snapshotCount": summary.snapshots.len(),
        "snapshots": summary.snapshots.clone()
    })
}

fn build_modality_runtime_contracts_json(
    summary: &RuntimeModalityContractSnapshotSummary,
) -> Value {
    json!({
        "applicableArtifactCount": summary.applicable_count,
        "snapshotCount": summary.snapshots.len(),
        "snapshotIndex": build_modality_runtime_contract_snapshot_index(&summary.snapshots),
        "snapshots": summary.snapshots.clone()
    })
}

fn build_modality_runtime_contract_snapshot_index(snapshots: &[Value]) -> Value {
    let mut contract_keys = BTreeSet::new();
    let mut sources: BTreeMap<String, usize> = BTreeMap::new();
    let mut routing_outcomes: BTreeMap<String, usize> = BTreeMap::new();
    let mut expected_routing_slots = BTreeSet::new();
    let mut trace_items = Vec::new();

    for snapshot in snapshots {
        let contract_key = snapshot_string(snapshot, "contractKey");
        let source = snapshot_string(snapshot, "source");
        let routing_outcome = snapshot_string(snapshot, "routingOutcome");
        let expected_routing_slot = snapshot_string(snapshot, "expectedRoutingSlot");

        if let Some(contract_key) = contract_key.as_deref() {
            contract_keys.insert(contract_key.to_string());
        }
        if let Some(source) = source.as_deref() {
            *sources.entry(source.to_string()).or_insert(0) += 1;
        }
        if let Some(routing_outcome) = routing_outcome.as_deref() {
            *routing_outcomes
                .entry(routing_outcome.to_string())
                .or_insert(0) += 1;
        }
        if let Some(expected_routing_slot) = expected_routing_slot.as_deref() {
            expected_routing_slots.insert(expected_routing_slot.to_string());
        }

        if source
            .as_deref()
            .map(is_runtime_contract_tool_trace_source)
            .unwrap_or(false)
        {
            trace_items.push(json!({
                "artifactPath": snapshot.get("artifactPath").cloned().unwrap_or(Value::Null),
                "source": source,
                "contractKey": contract_key,
                "routingEvent": snapshot.get("routingEvent").cloned().unwrap_or(Value::Null),
                "routingOutcome": snapshot.get("routingOutcome").cloned().unwrap_or(Value::Null),
                "expectedRoutingSlot": snapshot.get("expectedRoutingSlot").cloned().unwrap_or(Value::Null),
                "entrySource": snapshot.get("entrySource").cloned().unwrap_or(Value::Null),
                "executorBindingKey": snapshot
                    .pointer("/runtimeContract/executor_binding/binding_key")
                    .cloned()
                    .unwrap_or(Value::Null),
            }));
        }
    }

    json!({
        "contractKeys": contract_keys.into_iter().collect::<Vec<_>>(),
        "sourceCounts": sources
            .into_iter()
            .map(|(source, count)| json!({ "source": source, "count": count }))
            .collect::<Vec<_>>(),
        "routingOutcomeCounts": routing_outcomes
            .into_iter()
            .map(|(outcome, count)| json!({ "outcome": outcome, "count": count }))
            .collect::<Vec<_>>(),
        "expectedRoutingSlots": expected_routing_slots.into_iter().collect::<Vec<_>>(),
        "toolTraceIndex": {
            "traceCount": trace_items.len(),
            "items": trace_items,
        }
    })
}

fn snapshot_string(snapshot: &Value, field_name: &str) -> Option<String> {
    snapshot
        .get(field_name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn is_runtime_contract_tool_trace_source(source: &str) -> bool {
    source.contains("skill_trace")
        || source.contains("browser_action_trace")
        || source.contains("service_scene_trace")
        || source.contains("audio_task")
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

fn build_thread_runtime_facts_json(thread_read: &AgentRuntimeThreadReadModel) -> Value {
    json!({
        "taskKind": thread_read.task_kind,
        "serviceModelSlot": thread_read.service_model_slot,
        "routingMode": thread_read.routing_mode,
        "decisionSource": thread_read.decision_source,
        "candidateCount": thread_read.candidate_count,
        "capabilityGap": thread_read.capability_gap,
        "singleCandidateOnly": thread_read.single_candidate_only,
        "decisionReason": thread_read.decision_reason,
        "fallbackChain": thread_read.fallback_chain,
        "estimatedCostClass": thread_read.estimated_cost_class,
        "limitState": thread_read.limit_state,
        "costState": thread_read.cost_state,
        "limitEvent": thread_read.limit_event,
        "runtimeSummary": thread_read.runtime_summary,
        "oemPolicy": thread_read.oem_policy,
        "auxiliaryTaskRuntime": thread_read.auxiliary_task_runtime
    })
}

fn build_runtime_fact_signal_coverage(
    thread_read: &AgentRuntimeThreadReadModel,
) -> Vec<RuntimeEvidenceSignalCoverageEntry> {
    vec![
        RuntimeEvidenceSignalCoverageEntry {
            signal: "decisionReason",
            status: if normalize_optional_text(thread_read.decision_reason.clone()).is_some() {
                "exported"
            } else {
                "missing"
            },
            source: "thread_read.decision_reason",
            detail: if normalize_optional_text(thread_read.decision_reason.clone()).is_some() {
                "thread_read 已导出 decision_reason。".to_string()
            } else {
                "thread_read 缺少 decision_reason。".to_string()
            },
        },
        RuntimeEvidenceSignalCoverageEntry {
            signal: "fallbackChain",
            status: if thread_read
                .fallback_chain
                .as_ref()
                .is_some_and(|items| !items.is_empty())
            {
                "exported"
            } else {
                "missing"
            },
            source: "thread_read.fallback_chain",
            detail: if thread_read
                .fallback_chain
                .as_ref()
                .is_some_and(|items| !items.is_empty())
            {
                "thread_read 已导出 fallback_chain。".to_string()
            } else {
                "thread_read 缺少 fallback_chain。".to_string()
            },
        },
        RuntimeEvidenceSignalCoverageEntry {
            signal: "oemPolicy",
            status: if thread_read.oem_policy.is_some() {
                "exported"
            } else {
                "missing"
            },
            source: "thread_read.oem_policy",
            detail: if thread_read.oem_policy.is_some() {
                "thread_read 已导出 oem_policy。".to_string()
            } else {
                "thread_read 缺少 oem_policy。".to_string()
            },
        },
        RuntimeEvidenceSignalCoverageEntry {
            signal: "runtimeSummary",
            status: if thread_read.runtime_summary.is_some() {
                "exported"
            } else {
                "missing"
            },
            source: "thread_read.runtime_summary",
            detail: if thread_read.runtime_summary.is_some() {
                "thread_read 已导出 runtime_summary。".to_string()
            } else {
                "thread_read 缺少 runtime_summary。".to_string()
            },
        },
        RuntimeEvidenceSignalCoverageEntry {
            signal: "auxiliaryTaskRuntime",
            status: if thread_read
                .auxiliary_task_runtime
                .as_ref()
                .is_some_and(|items| !items.is_empty())
            {
                "exported"
            } else {
                "missing"
            },
            source: "thread_read.auxiliary_task_runtime",
            detail: if thread_read
                .auxiliary_task_runtime
                .as_ref()
                .is_some_and(|items| !items.is_empty())
            {
                "thread_read 已导出 auxiliary_task_runtime。".to_string()
            } else {
                "thread_read 缺少 auxiliary_task_runtime。".to_string()
            },
        },
    ]
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
    auxiliary_runtime: &RuntimeAuxiliaryRuntimeSnapshotSummary,
    modality_runtime_contracts: &RuntimeModalityContractSnapshotSummary,
    verification: &RuntimeEvidenceVerificationSummary,
    signal_coverage: &[RuntimeEvidenceSignalCoverageEntry],
    known_gaps: &[String],
) -> Value {
    let diagnostics = thread_read.diagnostics.as_ref();
    let mut signal_coverage = signal_coverage.to_vec();
    signal_coverage.extend(build_runtime_fact_signal_coverage(thread_read));
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
            "recentArtifactCount": recent_artifacts.len(),
            "auxiliaryRuntimeSnapshotCount": auxiliary_runtime.snapshots.len(),
            "modalityRuntimeContractCount": modality_runtime_contracts.snapshots.len()
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
    workspace_root: Option<&Path>,
    recent_artifacts: &[RuntimeRecentArtifact],
) -> RuntimeEvidenceVerificationSummary {
    RuntimeEvidenceVerificationSummary {
        artifact_validator: collect_artifact_validator_summary(workspace_root, recent_artifacts),
        browser_evidence: collect_browser_evidence(detail),
        gui_smoke: collect_gui_smoke_result(detail),
    }
}

fn collect_auxiliary_runtime_snapshots(
    workspace_root: Option<&Path>,
    recent_artifacts: &[RuntimeRecentArtifact],
) -> RuntimeAuxiliaryRuntimeSnapshotSummary {
    let mut summary = RuntimeAuxiliaryRuntimeSnapshotSummary::default();

    for artifact in recent_artifacts {
        if !is_auxiliary_runtime_applicable(artifact) {
            continue;
        }

        summary.applicable_count += 1;

        let Some(workspace_root) = workspace_root else {
            continue;
        };

        let absolute_path = resolve_workspace_path(workspace_root, artifact.path.as_str());
        let Ok(raw) = fs::read_to_string(&absolute_path) else {
            continue;
        };
        let Ok(document) = serde_json::from_str::<Value>(raw.as_str()) else {
            continue;
        };

        if let Some(snapshot) = extract_auxiliary_runtime_snapshot(document, artifact.path.as_str())
        {
            summary.snapshots.push(snapshot);
        }
    }

    summary
}

fn collect_modality_runtime_contract_snapshots(
    detail: &SessionDetail,
    workspace_root: Option<&Path>,
    recent_artifacts: &[RuntimeRecentArtifact],
) -> RuntimeModalityContractSnapshotSummary {
    let mut summary = RuntimeModalityContractSnapshotSummary::default();

    for artifact in recent_artifacts {
        if !is_modality_runtime_contract_applicable(artifact) {
            continue;
        }

        summary.applicable_count += 1;

        if let Some(metadata) = artifact.metadata.as_ref() {
            if let Some(snapshot) =
                extract_modality_runtime_contract_snapshot(metadata, artifact.path.as_str())
            {
                summary.snapshots.push(snapshot);
                continue;
            }
        }

        let Some(workspace_root) = workspace_root else {
            continue;
        };

        let absolute_path = resolve_workspace_path(workspace_root, artifact.path.as_str());
        let Ok(raw) = fs::read_to_string(&absolute_path) else {
            continue;
        };
        let Ok(document) = serde_json::from_str::<Value>(raw.as_str()) else {
            continue;
        };

        if let Some(snapshot) =
            extract_modality_runtime_contract_snapshot(&document, artifact.path.as_str())
        {
            summary.snapshots.push(snapshot);
        }
    }

    for item in detail.items.iter().rev() {
        let AgentThreadItemPayload::ToolCall {
            tool_name,
            arguments,
            success,
            metadata,
            ..
        } = &item.payload
        else {
            continue;
        };
        let artifact_path = format!("runtime_timeline/{}/{}", item.id, tool_name);
        let snapshot = if is_browser_tool_name(tool_name.as_str()) {
            metadata.as_ref().and_then(|metadata| {
                extract_modality_runtime_contract_snapshot(metadata, artifact_path.as_str())
            })
        } else {
            extract_pdf_read_skill_contract_snapshot(
                tool_name.as_str(),
                arguments.as_ref(),
                metadata.as_ref(),
                *success,
                artifact_path.as_str(),
            )
            .or_else(|| {
                extract_voice_generation_service_contract_snapshot(
                    tool_name.as_str(),
                    arguments.as_ref(),
                    metadata.as_ref(),
                    *success,
                    artifact_path.as_str(),
                )
            })
            .or_else(|| {
                extract_web_research_skill_contract_snapshot(
                    tool_name.as_str(),
                    arguments.as_ref(),
                    metadata.as_ref(),
                    *success,
                    artifact_path.as_str(),
                )
            })
            .or_else(|| {
                extract_text_transform_skill_contract_snapshot(
                    tool_name.as_str(),
                    arguments.as_ref(),
                    metadata.as_ref(),
                    *success,
                    artifact_path.as_str(),
                )
            })
        };
        let Some(snapshot) = snapshot else { continue };
        summary.applicable_count += 1;
        summary.snapshots.push(snapshot);
        if summary.snapshots.len() >= MAX_RECENT_ARTIFACTS {
            break;
        }
    }

    summary
}

fn collect_artifact_validator_summary(
    workspace_root: Option<&Path>,
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
            if let Some(workspace_root) = workspace_root {
                let absolute_path = resolve_workspace_path(workspace_root, artifact.path.as_str());
                if let Ok(raw) = fs::read_to_string(&absolute_path) {
                    if let Ok(document) = serde_json::from_str::<Value>(raw.as_str()) {
                        candidates.push(document);
                    }
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

fn extract_verification_failure_outcomes(
    verification: &RuntimeEvidenceVerificationSummary,
) -> Vec<String> {
    build_observability_verification_summary_json(verification)
        .and_then(|summary| {
            summary
                .get("focusVerificationFailureOutcomes")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
        })
        .unwrap_or_default()
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
    auxiliary_runtime: &RuntimeAuxiliaryRuntimeSnapshotSummary,
    modality_runtime_contracts: &RuntimeModalityContractSnapshotSummary,
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

    if auxiliary_runtime.applicable_count > 0 {
        coverage.push(RuntimeEvidenceSignalCoverageEntry {
            signal: "auxiliaryTaskRuntime",
            status: if auxiliary_runtime.snapshots.is_empty() {
                "known_gap"
            } else {
                "exported"
            },
            source: "image_task.title_generation_result",
            detail: if auxiliary_runtime.snapshots.is_empty() {
                format!(
                    "当前检测到 {} 个图片任务工件，但未从稳定 task artifact 中提取到 title_generation_result.execution_runtime 快照。",
                    auxiliary_runtime.applicable_count
                )
            } else {
                format!(
                    "当前证据包已从 {} 个图片任务工件中导出 {} 条辅助标题生成 runtime 快照。",
                    auxiliary_runtime.applicable_count,
                    auxiliary_runtime.snapshots.len()
                )
            },
        });
    }

    if modality_runtime_contracts.applicable_count > 0 {
        coverage.push(RuntimeEvidenceSignalCoverageEntry {
            signal: "modalityRuntimeContract",
            status: if modality_runtime_contracts.snapshots.is_empty() {
                "known_gap"
            } else {
                "exported"
            },
            source: "task_or_tool_trace.modality_runtime_contract",
            detail: if modality_runtime_contracts.snapshots.is_empty() {
                format!(
                    "当前检测到 {} 个多模态任务或工具 trace，但未从稳定事实源中提取到底层 ModalityRuntimeContract 快照。",
                    modality_runtime_contracts.applicable_count
                )
            } else {
                format!(
                    "当前证据包已从 {} 个多模态任务或工具 trace 中导出 {} 条 ModalityRuntimeContract / routing 决策快照。",
                    modality_runtime_contracts.applicable_count,
                    modality_runtime_contracts.snapshots.len()
                )
            },
        });
    }

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
    let mut blocking_failure = Vec::new();
    let mut advisory_failure = Vec::new();
    let mut recovered = Vec::new();

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
        let record_count = verification.artifact_validator.records.len();
        let outcome = if issue_count == 0 {
            if repaired_count > 0 || fallback_used_count > 0 {
                RuntimeVerificationOutcome::Recovered
            } else {
                RuntimeVerificationOutcome::Success
            }
        } else if record_count > 0 && repaired_count == record_count {
            RuntimeVerificationOutcome::Recovered
        } else {
            RuntimeVerificationOutcome::BlockingFailure
        };

        match outcome {
            RuntimeVerificationOutcome::BlockingFailure => blocking_failure.push(format!(
                "Artifact 校验存在 {} 条未恢复 issues。",
                issue_count
            )),
            RuntimeVerificationOutcome::Recovered => recovered.push(format!(
                "Artifact 校验已恢复 {} 个产物，fallback {} 次。",
                repaired_count, fallback_used_count
            )),
            RuntimeVerificationOutcome::Success => {}
            RuntimeVerificationOutcome::AdvisoryFailure => {}
        }

        payload.insert(
            "artifactValidator".to_string(),
            json!({
                "applicable": true,
                "recordCount": record_count,
                "issueCount": issue_count,
                "repairedCount": repaired_count,
                "fallbackUsedCount": fallback_used_count,
                "outcome": outcome.as_str()
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
        let outcome = if failure_count > 0 {
            RuntimeVerificationOutcome::BlockingFailure
        } else if unknown_count > 0 {
            RuntimeVerificationOutcome::AdvisoryFailure
        } else {
            RuntimeVerificationOutcome::Success
        };

        match outcome {
            RuntimeVerificationOutcome::BlockingFailure => {
                blocking_failure.push(format!("浏览器验证存在 {} 条失败线索。", failure_count))
            }
            RuntimeVerificationOutcome::AdvisoryFailure => {
                advisory_failure.push(format!("浏览器验证仍有 {} 条未判定线索。", unknown_count))
            }
            RuntimeVerificationOutcome::Success => {}
            RuntimeVerificationOutcome::Recovered => {}
        }

        payload.insert(
            "browserVerification".to_string(),
            json!({
                "recordCount": verification.browser_evidence.len(),
                "successCount": success_count,
                "failureCount": failure_count,
                "unknownCount": unknown_count,
                "latestUpdatedAt": latest_updated_at,
                "outcome": outcome.as_str()
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
        let outcome = if passed {
            RuntimeVerificationOutcome::Success
        } else {
            RuntimeVerificationOutcome::BlockingFailure
        };

        if !passed {
            let exit_code_text = exit_code
                .map(|value| value.to_string())
                .unwrap_or_else(|| "未知".to_string());
            blocking_failure.push(format!("GUI smoke 未通过，exit_code={}。", exit_code_text));
        }

        payload.insert(
            "guiSmoke".to_string(),
            json!({
                "status": gui_smoke.get("status").cloned().unwrap_or(Value::Null),
                "exitCode": exit_code,
                "passed": passed,
                "updatedAt": gui_smoke.get("updatedAt").cloned().unwrap_or(Value::Null),
                "hasOutputPreview": gui_smoke.get("outputPreview").is_some(),
                "outcome": outcome.as_str()
            }),
        );
    }

    if !blocking_failure.is_empty() || !advisory_failure.is_empty() || !recovered.is_empty() {
        payload.insert(
            "observabilityVerificationOutcomes".to_string(),
            json!({
                "blockingFailure": blocking_failure,
                "advisoryFailure": advisory_failure,
                "recovered": recovered
            }),
        );
        payload.insert(
            "focusVerificationFailureOutcomes".to_string(),
            json!(blocking_failure
                .iter()
                .chain(advisory_failure.iter())
                .cloned()
                .collect::<Vec<_>>()),
        );
        payload.insert(
            "focusVerificationRecoveredOutcomes".to_string(),
            json!(recovered),
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

fn is_auxiliary_runtime_applicable(artifact: &RuntimeRecentArtifact) -> bool {
    let normalized_path = artifact.path.replace('\\', "/").to_ascii_lowercase();
    if normalized_path.contains(".lime/tasks/image_generate/") {
        return true;
    }
    if normalized_path.contains("/auxiliary-runtime/") {
        return true;
    }

    artifact
        .metadata
        .as_ref()
        .and_then(|metadata| {
            read_json_string(
                metadata,
                &[
                    &["task_type"][..],
                    &["taskType"][..],
                    &["type"][..],
                    &["artifactType"][..],
                ],
            )
        })
        .map(|value| {
            value.eq_ignore_ascii_case("image_generate")
                || value.eq_ignore_ascii_case("auxiliary_runtime_projection")
        })
        .unwrap_or(false)
}

fn is_modality_runtime_contract_applicable(artifact: &RuntimeRecentArtifact) -> bool {
    let normalized_path = artifact.path.replace('\\', "/").to_ascii_lowercase();
    if normalized_path.contains(".lime/tasks/image_generate/")
        || normalized_path.contains(".lime/tasks/audio_generate/")
    {
        return true;
    }

    artifact
        .metadata
        .as_ref()
        .map(|metadata| {
            read_json_string(
                metadata,
                &[
                    &["modality_contract_key"][..],
                    &["modalityContractKey"][..],
                    &["runtime_contract", "contract_key"][..],
                    &["runtimeContract", "contractKey"][..],
                ],
            )
            .is_some()
                || read_json_string(
                    metadata,
                    &[
                        &["task_type"][..],
                        &["taskType"][..],
                        &["type"][..],
                        &["artifactType"][..],
                    ],
                )
                .map(|value| {
                    value.eq_ignore_ascii_case("image_generate")
                        || value.eq_ignore_ascii_case("audio_generate")
                })
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn extract_pdf_read_skill_contract_snapshot(
    tool_name: &str,
    arguments: Option<&Value>,
    metadata: Option<&Value>,
    success: Option<bool>,
    artifact_path: &str,
) -> Option<Value> {
    if !is_pdf_read_skill_tool_call(tool_name, arguments, metadata) {
        return None;
    }

    for mut document in collect_pdf_extract_contract_documents(arguments, metadata) {
        apply_tool_call_status_to_contract_document(&mut document, success);
        if let Some(snapshot) = extract_modality_runtime_contract_snapshot(&document, artifact_path)
        {
            return Some(snapshot);
        }
    }

    None
}

fn is_pdf_read_skill_tool_call(
    tool_name: &str,
    arguments: Option<&Value>,
    metadata: Option<&Value>,
) -> bool {
    let normalized_tool_name = tool_name.trim().to_ascii_lowercase();
    let tool_is_skill = normalized_tool_name == "skill" || normalized_tool_name.contains("skill");
    let tool_is_pdf_read = normalized_tool_name == "pdf_read"
        || normalized_tool_name.contains("pdf_read")
        || normalized_tool_name.contains("pdf-read");
    let argument_skill_is_pdf_read = arguments
        .and_then(|arguments| {
            read_json_string(
                arguments,
                &[
                    &["skill"][..],
                    &["skill_name"][..],
                    &["skillName"][..],
                    &["name"][..],
                ],
            )
        })
        .map(|value| value == "pdf_read")
        .unwrap_or(false);
    let has_pdf_contract = !collect_pdf_extract_contract_documents(arguments, metadata).is_empty();

    tool_is_pdf_read || (tool_is_skill && (argument_skill_is_pdf_read || has_pdf_contract))
}

fn collect_pdf_extract_contract_documents(
    arguments: Option<&Value>,
    metadata: Option<&Value>,
) -> Vec<Value> {
    let mut documents = Vec::new();

    if let Some(metadata) = metadata {
        push_pdf_extract_contract_candidates(metadata, &mut documents);
    }

    if let Some(arguments) = arguments {
        push_pdf_extract_contract_candidates(arguments, &mut documents);
        if let Some(skill_args) = arguments.get("args") {
            match skill_args {
                Value::Object(_) => {
                    push_pdf_extract_contract_candidates(skill_args, &mut documents)
                }
                Value::String(text) => {
                    if let Ok(parsed) = serde_json::from_str::<Value>(text.trim()) {
                        push_pdf_extract_contract_candidates(&parsed, &mut documents);
                    }
                }
                _ => {}
            }
        }
    }

    documents
        .into_iter()
        .filter(has_pdf_extract_contract)
        .collect()
}

fn push_pdf_extract_contract_candidates(source: &Value, documents: &mut Vec<Value>) {
    documents.push(source.clone());
    for path in [
        &["harness", "pdf_read_skill_launch"][..],
        &["harness", "pdfReadSkillLaunch"][..],
        &["harness", "pdf_read_skill_launch", "pdf_read_request"][..],
        &["harness", "pdfReadSkillLaunch", "pdfReadRequest"][..],
        &["pdf_read_skill_launch"][..],
        &["pdfReadSkillLaunch"][..],
        &["pdf_read_skill_launch", "pdf_read_request"][..],
        &["pdfReadSkillLaunch", "pdfReadRequest"][..],
        &["pdf_read_request"][..],
        &["pdfReadRequest"][..],
    ] {
        if let Some(candidate) = find_json_value(source, path) {
            documents.push(candidate.clone());
        }
    }
}

fn has_pdf_extract_contract(document: &Value) -> bool {
    read_json_string(
        document,
        &[
            &["modality_contract_key"][..],
            &["modalityContractKey"][..],
            &["runtime_contract", "contract_key"][..],
            &["runtimeContract", "contractKey"][..],
        ],
    )
    .map(|value| value == PDF_EXTRACT_CONTRACT_KEY)
    .unwrap_or(false)
}

fn extract_voice_generation_service_contract_snapshot(
    tool_name: &str,
    arguments: Option<&Value>,
    metadata: Option<&Value>,
    success: Option<bool>,
    artifact_path: &str,
) -> Option<Value> {
    if !is_voice_generation_service_tool_call(tool_name, arguments, metadata) {
        return None;
    }

    for mut document in collect_voice_generation_contract_documents(arguments, metadata) {
        apply_tool_call_status_to_contract_document(&mut document, success);
        if let Some(snapshot) = extract_modality_runtime_contract_snapshot(&document, artifact_path)
        {
            return Some(snapshot);
        }
    }

    None
}

fn is_voice_generation_service_tool_call(
    tool_name: &str,
    arguments: Option<&Value>,
    metadata: Option<&Value>,
) -> bool {
    let normalized_tool_name = tool_name.trim().to_ascii_lowercase();
    let tool_is_voice_generation = normalized_tool_name == "voice_runtime"
        || normalized_tool_name.contains("voice_runtime")
        || normalized_tool_name.contains("voice-generation")
        || normalized_tool_name.contains("voice_generation");
    let tool_is_service_scene = normalized_tool_name.contains("service_scene")
        || normalized_tool_name.contains("service-skill")
        || normalized_tool_name.contains("service_skill")
        || normalized_tool_name.contains("lime_run_service_skill");
    let has_voice_contract =
        !collect_voice_generation_contract_documents(arguments, metadata).is_empty();

    tool_is_voice_generation || (tool_is_service_scene && has_voice_contract)
}

fn collect_voice_generation_contract_documents(
    arguments: Option<&Value>,
    metadata: Option<&Value>,
) -> Vec<Value> {
    let mut documents = Vec::new();

    if let Some(metadata) = metadata {
        push_voice_generation_contract_candidates(metadata, &mut documents);
    }

    if let Some(arguments) = arguments {
        push_voice_generation_contract_candidates(arguments, &mut documents);
        if let Some(skill_args) = arguments.get("args") {
            match skill_args {
                Value::Object(_) => {
                    push_voice_generation_contract_candidates(skill_args, &mut documents)
                }
                Value::String(text) => {
                    if let Ok(parsed) = serde_json::from_str::<Value>(text.trim()) {
                        push_voice_generation_contract_candidates(&parsed, &mut documents);
                    }
                }
                _ => {}
            }
        }
    }

    documents
        .into_iter()
        .filter(has_voice_generation_contract)
        .collect()
}

fn push_voice_generation_contract_candidates(source: &Value, documents: &mut Vec<Value>) {
    documents.push(source.clone());
    for path in [
        &["harness", "service_scene_launch"][..],
        &["harness", "serviceSceneLaunch"][..],
        &["harness", "service_scene_launch", "service_scene_run"][..],
        &["harness", "serviceSceneLaunch", "serviceSceneRun"][..],
        &["service_scene_launch"][..],
        &["serviceSceneLaunch"][..],
        &["service_scene_launch", "service_scene_run"][..],
        &["serviceSceneLaunch", "serviceSceneRun"][..],
        &["service_scene_run"][..],
        &["serviceSceneRun"][..],
        &["result"][..],
        &["result", "service_scene_launch"][..],
        &["result", "serviceSceneLaunch"][..],
        &["result", "service_scene_launch", "service_scene_run"][..],
        &["result", "serviceSceneLaunch", "serviceSceneRun"][..],
        &["result", "service_scene_run"][..],
        &["result", "serviceSceneRun"][..],
    ] {
        if let Some(candidate) = find_json_value(source, path) {
            documents.push(candidate.clone());
        }
    }
}

fn has_voice_generation_contract(document: &Value) -> bool {
    read_json_string(
        document,
        &[
            &["modality_contract_key"][..],
            &["modalityContractKey"][..],
            &["runtime_contract", "contract_key"][..],
            &["runtimeContract", "contractKey"][..],
        ],
    )
    .map(|value| value == VOICE_GENERATION_CONTRACT_KEY)
    .unwrap_or(false)
}

fn extract_web_research_skill_contract_snapshot(
    tool_name: &str,
    arguments: Option<&Value>,
    metadata: Option<&Value>,
    success: Option<bool>,
    artifact_path: &str,
) -> Option<Value> {
    if !is_web_research_skill_tool_call(tool_name, arguments, metadata) {
        return None;
    }

    for mut document in collect_web_research_contract_documents(arguments, metadata) {
        apply_tool_call_status_to_contract_document(&mut document, success);
        if let Some(snapshot) = extract_modality_runtime_contract_snapshot(&document, artifact_path)
        {
            return Some(snapshot);
        }
    }

    None
}

fn is_web_research_skill_tool_call(
    tool_name: &str,
    arguments: Option<&Value>,
    metadata: Option<&Value>,
) -> bool {
    let normalized_tool_name = tool_name.trim().to_ascii_lowercase();
    let tool_is_skill = normalized_tool_name == "skill" || normalized_tool_name.contains("skill");
    let tool_is_research = normalized_tool_name == "research"
        || normalized_tool_name.contains("research")
        || normalized_tool_name == "site_search"
        || normalized_tool_name.contains("site_search")
        || normalized_tool_name.contains("site-search")
        || normalized_tool_name == "report_generate"
        || normalized_tool_name.contains("report_generate")
        || normalized_tool_name.contains("report-generate");
    let argument_skill_is_web_research = arguments
        .and_then(|arguments| {
            read_json_string(
                arguments,
                &[
                    &["skill"][..],
                    &["skill_name"][..],
                    &["skillName"][..],
                    &["name"][..],
                ],
            )
        })
        .map(|value| value == "research" || value == "site_search" || value == "report_generate")
        .unwrap_or(false);
    let has_web_research_contract =
        !collect_web_research_contract_documents(arguments, metadata).is_empty();

    tool_is_research
        || (tool_is_skill && (argument_skill_is_web_research || has_web_research_contract))
}

fn collect_web_research_contract_documents(
    arguments: Option<&Value>,
    metadata: Option<&Value>,
) -> Vec<Value> {
    let mut documents = Vec::new();

    if let Some(metadata) = metadata {
        push_web_research_contract_candidates(metadata, &mut documents);
    }

    if let Some(arguments) = arguments {
        push_web_research_contract_candidates(arguments, &mut documents);
        if let Some(skill_args) = arguments.get("args") {
            match skill_args {
                Value::Object(_) => {
                    push_web_research_contract_candidates(skill_args, &mut documents)
                }
                Value::String(text) => {
                    if let Ok(parsed) = serde_json::from_str::<Value>(text.trim()) {
                        push_web_research_contract_candidates(&parsed, &mut documents);
                    }
                }
                _ => {}
            }
        }
    }

    documents
        .into_iter()
        .filter(has_web_research_contract)
        .collect()
}

fn push_web_research_contract_candidates(source: &Value, documents: &mut Vec<Value>) {
    documents.push(source.clone());
    for path in [
        &["harness", "research_skill_launch"][..],
        &["harness", "researchSkillLaunch"][..],
        &["harness", "research_skill_launch", "research_request"][..],
        &["harness", "researchSkillLaunch", "researchRequest"][..],
        &["harness", "deep_search_skill_launch"][..],
        &["harness", "deepSearchSkillLaunch"][..],
        &["harness", "deep_search_skill_launch", "deep_search_request"][..],
        &["harness", "deepSearchSkillLaunch", "deepSearchRequest"][..],
        &["harness", "site_search_skill_launch"][..],
        &["harness", "siteSearchSkillLaunch"][..],
        &["harness", "site_search_skill_launch", "site_search_request"][..],
        &["harness", "siteSearchSkillLaunch", "siteSearchRequest"][..],
        &["harness", "report_skill_launch"][..],
        &["harness", "reportSkillLaunch"][..],
        &["harness", "report_skill_launch", "report_request"][..],
        &["harness", "reportSkillLaunch", "reportRequest"][..],
        &["research_skill_launch"][..],
        &["researchSkillLaunch"][..],
        &["research_skill_launch", "research_request"][..],
        &["researchSkillLaunch", "researchRequest"][..],
        &["deep_search_skill_launch"][..],
        &["deepSearchSkillLaunch"][..],
        &["deep_search_skill_launch", "deep_search_request"][..],
        &["deepSearchSkillLaunch", "deepSearchRequest"][..],
        &["site_search_skill_launch"][..],
        &["siteSearchSkillLaunch"][..],
        &["site_search_skill_launch", "site_search_request"][..],
        &["siteSearchSkillLaunch", "siteSearchRequest"][..],
        &["report_skill_launch"][..],
        &["reportSkillLaunch"][..],
        &["report_skill_launch", "report_request"][..],
        &["reportSkillLaunch", "reportRequest"][..],
        &["research_request"][..],
        &["researchRequest"][..],
        &["deep_search_request"][..],
        &["deepSearchRequest"][..],
        &["site_search_request"][..],
        &["siteSearchRequest"][..],
        &["report_request"][..],
        &["reportRequest"][..],
    ] {
        if let Some(candidate) = find_json_value(source, path) {
            documents.push(candidate.clone());
        }
    }
}

fn has_web_research_contract(document: &Value) -> bool {
    read_json_string(
        document,
        &[
            &["modality_contract_key"][..],
            &["modalityContractKey"][..],
            &["runtime_contract", "contract_key"][..],
            &["runtimeContract", "contractKey"][..],
        ],
    )
    .map(|value| value == WEB_RESEARCH_CONTRACT_KEY)
    .unwrap_or(false)
}

fn extract_text_transform_skill_contract_snapshot(
    tool_name: &str,
    arguments: Option<&Value>,
    metadata: Option<&Value>,
    success: Option<bool>,
    artifact_path: &str,
) -> Option<Value> {
    if !is_text_transform_skill_tool_call(tool_name, arguments, metadata) {
        return None;
    }

    for mut document in collect_text_transform_contract_documents(arguments, metadata) {
        apply_tool_call_status_to_contract_document(&mut document, success);
        if let Some(snapshot) = extract_modality_runtime_contract_snapshot(&document, artifact_path)
        {
            return Some(snapshot);
        }
    }

    None
}

fn is_text_transform_skill_tool_call(
    tool_name: &str,
    arguments: Option<&Value>,
    metadata: Option<&Value>,
) -> bool {
    let normalized_tool_name = tool_name.trim().to_ascii_lowercase();
    let tool_is_skill = normalized_tool_name == "skill" || normalized_tool_name.contains("skill");
    let tool_is_text_transform = normalized_tool_name == "summary"
        || normalized_tool_name.contains("summary")
        || normalized_tool_name == "translation"
        || normalized_tool_name.contains("translation")
        || normalized_tool_name == "analysis"
        || normalized_tool_name.contains("analysis");
    let argument_skill_is_text_transform = arguments
        .and_then(|arguments| {
            read_json_string(
                arguments,
                &[
                    &["skill"][..],
                    &["skill_name"][..],
                    &["skillName"][..],
                    &["name"][..],
                ],
            )
        })
        .map(|value| value == "summary" || value == "translation" || value == "analysis")
        .unwrap_or(false);
    let has_text_transform_contract =
        !collect_text_transform_contract_documents(arguments, metadata).is_empty();

    tool_is_text_transform
        || (tool_is_skill && (argument_skill_is_text_transform || has_text_transform_contract))
}

fn collect_text_transform_contract_documents(
    arguments: Option<&Value>,
    metadata: Option<&Value>,
) -> Vec<Value> {
    let mut documents = Vec::new();

    if let Some(metadata) = metadata {
        push_text_transform_contract_candidates(metadata, &mut documents);
    }

    if let Some(arguments) = arguments {
        push_text_transform_contract_candidates(arguments, &mut documents);
        if let Some(skill_args) = arguments.get("args") {
            match skill_args {
                Value::Object(_) => {
                    push_text_transform_contract_candidates(skill_args, &mut documents)
                }
                Value::String(text) => {
                    if let Ok(parsed) = serde_json::from_str::<Value>(text.trim()) {
                        push_text_transform_contract_candidates(&parsed, &mut documents);
                    }
                }
                _ => {}
            }
        }
    }

    documents
        .into_iter()
        .filter(has_text_transform_contract)
        .collect()
}

fn push_text_transform_contract_candidates(source: &Value, documents: &mut Vec<Value>) {
    documents.push(source.clone());
    for path in [
        &["harness", "summary_skill_launch"][..],
        &["harness", "summarySkillLaunch"][..],
        &["harness", "summary_skill_launch", "summary_request"][..],
        &["harness", "summarySkillLaunch", "summaryRequest"][..],
        &["harness", "translation_skill_launch"][..],
        &["harness", "translationSkillLaunch"][..],
        &["harness", "translation_skill_launch", "translation_request"][..],
        &["harness", "translationSkillLaunch", "translationRequest"][..],
        &["harness", "analysis_skill_launch"][..],
        &["harness", "analysisSkillLaunch"][..],
        &["harness", "analysis_skill_launch", "analysis_request"][..],
        &["harness", "analysisSkillLaunch", "analysisRequest"][..],
        &["summary_skill_launch"][..],
        &["summarySkillLaunch"][..],
        &["summary_skill_launch", "summary_request"][..],
        &["summarySkillLaunch", "summaryRequest"][..],
        &["translation_skill_launch"][..],
        &["translationSkillLaunch"][..],
        &["translation_skill_launch", "translation_request"][..],
        &["translationSkillLaunch", "translationRequest"][..],
        &["analysis_skill_launch"][..],
        &["analysisSkillLaunch"][..],
        &["analysis_skill_launch", "analysis_request"][..],
        &["analysisSkillLaunch", "analysisRequest"][..],
        &["summary_request"][..],
        &["summaryRequest"][..],
        &["translation_request"][..],
        &["translationRequest"][..],
        &["analysis_request"][..],
        &["analysisRequest"][..],
    ] {
        if let Some(candidate) = find_json_value(source, path) {
            documents.push(candidate.clone());
        }
    }
}

fn has_text_transform_contract(document: &Value) -> bool {
    read_json_string(
        document,
        &[
            &["modality_contract_key"][..],
            &["modalityContractKey"][..],
            &["runtime_contract", "contract_key"][..],
            &["runtimeContract", "contractKey"][..],
        ],
    )
    .map(|value| value == TEXT_TRANSFORM_CONTRACT_KEY)
    .unwrap_or(false)
}

fn apply_tool_call_status_to_contract_document(document: &mut Value, success: Option<bool>) {
    let Some(map) = document.as_object_mut() else {
        return;
    };
    let status = match success {
        Some(false) => "failed",
        Some(true) => "completed",
        None => return,
    };
    map.entry("status".to_string())
        .or_insert_with(|| Value::String(status.to_string()));
    map.entry("normalized_status".to_string())
        .or_insert_with(|| Value::String(status.to_string()));
}

fn extract_modality_runtime_contract_snapshot(
    document: &Value,
    artifact_path: &str,
) -> Option<Value> {
    let contract_key = read_json_string(
        document,
        &[
            &["modality_contract_key"][..],
            &["modalityContractKey"][..],
            &["payload", "modality_contract_key"][..],
            &["payload", "modalityContractKey"][..],
            &["record", "payload", "modality_contract_key"][..],
            &["record", "payload", "modalityContractKey"][..],
            &["runtime_contract", "contract_key"][..],
            &["runtimeContract", "contractKey"][..],
            &["payload", "runtime_contract", "contract_key"][..],
            &["payload", "runtimeContract", "contractKey"][..],
            &["record", "payload", "runtime_contract", "contract_key"][..],
            &["record", "payload", "runtimeContract", "contractKey"][..],
        ],
    )?;
    let task_type = read_json_string(
        document,
        &[
            &["task_type"][..],
            &["taskType"][..],
            &["record", "task_type"][..],
            &["record", "taskType"][..],
        ],
    );
    let normalized_status = read_json_string(
        document,
        &[
            &["normalized_status"][..],
            &["normalizedStatus"][..],
            &["record", "normalized_status"][..],
            &["record", "normalizedStatus"][..],
        ],
    );
    let last_error = find_json_value_at_paths(
        document,
        &[
            &["last_error"][..],
            &["lastError"][..],
            &["record", "last_error"][..],
            &["record", "lastError"][..],
        ],
    )
    .filter(|value| !value.is_null())
    .cloned();
    let failure_code = last_error
        .as_ref()
        .and_then(|error| read_json_string(error, &[&["code"][..]]));
    let failure_stage = last_error
        .as_ref()
        .and_then(|error| read_json_string(error, &[&["stage"][..]]));
    let is_contract_routing_failure = failure_code
        .as_deref()
        .map(is_modality_contract_routing_failure_code)
        .unwrap_or(false);
    let is_image_generation_contract = contract_key == IMAGE_GENERATION_CONTRACT_KEY;
    let is_browser_control_contract = contract_key == BROWSER_CONTROL_CONTRACT_KEY;
    let is_pdf_extract_contract = contract_key == PDF_EXTRACT_CONTRACT_KEY;
    let is_voice_generation_contract = contract_key == VOICE_GENERATION_CONTRACT_KEY;
    let is_web_research_contract = contract_key == WEB_RESEARCH_CONTRACT_KEY;
    let is_text_transform_contract = contract_key == TEXT_TRANSFORM_CONTRACT_KEY;
    let is_audio_task_artifact = is_voice_generation_contract
        && (task_type.as_deref() == Some("audio_generate")
            || artifact_path
                .replace('\\', "/")
                .to_ascii_lowercase()
                .contains(".lime/tasks/audio_generate/"));
    let routing_event = if is_contract_routing_failure {
        "routing_not_possible"
    } else if is_browser_control_contract {
        "browser_action_requested"
    } else if is_pdf_extract_contract
        || is_voice_generation_contract
        || is_web_research_contract
        || is_text_transform_contract
    {
        "executor_invoked"
    } else {
        "model_routing_decision"
    };
    let routing_outcome = if is_contract_routing_failure {
        "blocked"
    } else if normalized_status.as_deref() == Some("failed") {
        "failed"
    } else {
        "accepted"
    };

    Some(json!({
        "artifactPath": artifact_path,
        "source": if is_browser_control_contract {
            "browser_action_trace.modality_runtime_contract"
        } else if is_pdf_extract_contract {
            "pdf_read_skill_trace.modality_runtime_contract"
        } else if is_audio_task_artifact {
            "audio_task.modality_runtime_contract"
        } else if is_voice_generation_contract {
            "voice_generation_service_scene_trace.modality_runtime_contract"
        } else if is_web_research_contract {
            "web_research_skill_trace.modality_runtime_contract"
        } else if is_text_transform_contract {
            "text_transform_skill_trace.modality_runtime_contract"
        } else {
            "image_task.modality_runtime_contract"
        },
        "taskId": read_json_string(
            document,
            &[
                &["task_id"][..],
                &["taskId"][..],
                &["record", "task_id"][..],
                &["record", "taskId"][..],
            ],
        ),
        "taskType": task_type,
        "status": read_json_string(
            document,
            &[
                &["status"][..],
                &["record", "status"][..],
            ],
        ),
        "normalizedStatus": normalized_status,
        "contractKey": contract_key,
        "contractMatchedExpected": is_image_generation_contract || is_browser_control_contract || is_pdf_extract_contract || is_voice_generation_contract || is_web_research_contract || is_text_transform_contract,
        "expectedRoutingSlot": if is_image_generation_contract {
            Some(IMAGE_GENERATION_ROUTING_SLOT)
        } else if is_browser_control_contract {
            Some(BROWSER_CONTROL_ROUTING_SLOT)
        } else if is_pdf_extract_contract {
            Some(PDF_EXTRACT_ROUTING_SLOT)
        } else if is_voice_generation_contract {
            Some(VOICE_GENERATION_ROUTING_SLOT)
        } else if is_web_research_contract {
            Some(WEB_RESEARCH_ROUTING_SLOT)
        } else if is_text_transform_contract {
            Some(TEXT_TRANSFORM_ROUTING_SLOT)
        } else {
            None
        },
        "entrySource": read_json_string(
            document,
            &[
                &["entry_source"][..],
                &["entrySource"][..],
                &["payload", "entry_source"][..],
                &["payload", "entrySource"][..],
                &["record", "payload", "entry_source"][..],
                &["record", "payload", "entrySource"][..],
            ],
        ),
        "modality": read_json_string(
            document,
            &[
                &["modality"][..],
                &["payload", "modality"][..],
                &["record", "payload", "modality"][..],
            ],
        ),
        "requiredCapabilities": read_json_string_array(
            document,
            &[
                &["required_capabilities"][..],
                &["requiredCapabilities"][..],
                &["payload", "required_capabilities"][..],
                &["payload", "requiredCapabilities"][..],
                &["record", "payload", "required_capabilities"][..],
                &["record", "payload", "requiredCapabilities"][..],
            ],
        ),
        "routingSlot": read_json_string(
            document,
            &[
                &["routing_slot"][..],
                &["routingSlot"][..],
                &["payload", "routing_slot"][..],
                &["payload", "routingSlot"][..],
                &["record", "payload", "routing_slot"][..],
                &["record", "payload", "routingSlot"][..],
            ],
        ),
        "providerId": read_json_string(
            document,
            &[
                &["provider_id"][..],
                &["providerId"][..],
                &["preferred_provider_id"][..],
                &["preferredProviderId"][..],
                &["payload", "provider_id"][..],
                &["payload", "providerId"][..],
                &["payload", "preferred_provider_id"][..],
                &["payload", "preferredProviderId"][..],
                &["record", "payload", "provider_id"][..],
                &["record", "payload", "providerId"][..],
                &["record", "payload", "preferred_provider_id"][..],
                &["record", "payload", "preferredProviderId"][..],
            ],
        ),
        "model": read_json_string(
            document,
            &[
                &["model"][..],
                &["preferred_model_id"][..],
                &["preferredModelId"][..],
                &["payload", "model"][..],
                &["payload", "preferred_model_id"][..],
                &["payload", "preferredModelId"][..],
                &["record", "payload", "model"][..],
                &["record", "payload", "preferred_model_id"][..],
                &["record", "payload", "preferredModelId"][..],
            ],
        ),
        "modelCapabilityAssessment": find_json_value_at_paths(
            document,
            &[
                &["model_capability_assessment"][..],
                &["modelCapabilityAssessment"][..],
                &["payload", "model_capability_assessment"][..],
                &["payload", "modelCapabilityAssessment"][..],
                &["record", "payload", "model_capability_assessment"][..],
                &["record", "payload", "modelCapabilityAssessment"][..],
            ],
        )
        .cloned(),
        "routingEvent": routing_event,
        "routingOutcome": routing_outcome,
        "failureCode": failure_code,
        "failureStage": failure_stage,
        "lastError": last_error,
        "runtimeContract": find_json_value_at_paths(
            document,
            &[
                &["runtime_contract"][..],
                &["runtimeContract"][..],
                &["payload", "runtime_contract"][..],
                &["payload", "runtimeContract"][..],
                &["record", "payload", "runtime_contract"][..],
                &["record", "payload", "runtimeContract"][..],
            ],
        )
        .cloned()
    }))
}

fn is_modality_contract_routing_failure_code(code: &str) -> bool {
    matches!(
        code.trim(),
        "image_generation_contract_mismatch"
            | "image_generation_capability_gap"
            | "image_generation_routing_slot_mismatch"
            | "image_generation_model_capability_gap"
    )
}

fn extract_auxiliary_runtime_snapshot(document: Value, artifact_path: &str) -> Option<Value> {
    if let Some(snapshot) = extract_auxiliary_runtime_projection_snapshot(&document, artifact_path)
    {
        return Some(snapshot);
    }

    let title_generation_result = find_json_value_at_paths(
        &document,
        &[
            &["title_generation_result"][..],
            &["titleGenerationResult"][..],
            &["payload", "title_generation_result"][..],
            &["payload", "titleGenerationResult"][..],
            &["record", "payload", "title_generation_result"][..],
            &["record", "payload", "titleGenerationResult"][..],
        ],
    )?;
    let execution_runtime = find_json_value_at_paths(
        title_generation_result,
        &[
            &["execution_runtime"][..],
            &["executionRuntime"][..],
            &["runtime"][..],
        ],
    )?
    .clone();

    let session_id = read_json_string(
        title_generation_result,
        &[&["sessionId"][..], &["session_id"][..]],
    )
    .or_else(|| {
        read_json_string(
            &execution_runtime,
            &[&["session_id"][..], &["sessionId"][..]],
        )
    });

    Some(json!({
        "artifactPath": artifact_path,
        "source": "image_task.title_generation_result",
        "title": read_json_string(title_generation_result, &[&["title"][..]]),
        "sessionId": session_id,
        "usedFallback": read_json_bool(
            title_generation_result,
            &[&["usedFallback"][..], &["used_fallback"][..]]
        ),
        "fallbackReason": read_json_string(
            title_generation_result,
            &[&["fallbackReason"][..], &["fallback_reason"][..]]
        ),
        "route": read_json_string(&execution_runtime, &[&["route"][..]]),
        "runtimeSource": read_json_string(&execution_runtime, &[&["source"][..]]),
        "taskKind": read_json_string(
            &execution_runtime,
            &[
                &["task_profile", "kind"][..],
                &["task_profile", "task_kind"][..],
                &["taskProfile", "kind"][..],
                &["taskProfile", "taskKind"][..],
                &["task_kind"][..],
                &["taskKind"][..],
            ]
        ),
        "routingMode": read_json_string(
            &execution_runtime,
            &[
                &["routing_decision", "routingMode"][..],
                &["routing_decision", "routing_mode"][..],
                &["routingDecision", "routingMode"][..],
                &["routingDecision", "routing_mode"][..],
                &["routing_mode"][..],
                &["routingMode"][..],
            ]
        ),
        "decisionSource": read_json_string(
            &execution_runtime,
            &[
                &["routing_decision", "decisionSource"][..],
                &["routing_decision", "decision_source"][..],
                &["routingDecision", "decisionSource"][..],
                &["routingDecision", "decision_source"][..],
                &["decision_source"][..],
                &["decisionSource"][..],
            ]
        ),
        "estimatedCostClass": read_json_string(
            &execution_runtime,
            &[
                &["cost_state", "estimatedCostClass"][..],
                &["cost_state", "estimated_cost_class"][..],
                &["costState", "estimatedCostClass"][..],
                &["costState", "estimated_cost_class"][..],
                &["estimated_cost_class"][..],
                &["estimatedCostClass"][..],
            ]
        ),
        "executionRuntime": execution_runtime
    }))
}

fn extract_auxiliary_runtime_projection_snapshot(
    document: &Value,
    artifact_path: &str,
) -> Option<Value> {
    let projection_kind = read_json_string(
        document,
        &[&["projectionKind"][..], &["projection_kind"][..]],
    )?;
    let execution_runtime = find_json_value_at_paths(
        document,
        &[&["executionRuntime"][..], &["execution_runtime"][..]],
    )
    .cloned();
    let title_generation_result = find_json_value_at_paths(
        document,
        &[
            &["titleGenerationResult"][..],
            &["title_generation_result"][..],
        ],
    );
    let persona_generation_result = find_json_value_at_paths(
        document,
        &[
            &["personaGenerationResult"][..],
            &["persona_generation_result"][..],
        ],
    );

    let session_id = read_json_string(
        document,
        &[
            &["auxiliarySessionId"][..],
            &["auxiliary_session_id"][..],
            &["sessionId"][..],
            &["session_id"][..],
        ],
    )
    .or_else(|| {
        execution_runtime.as_ref().and_then(|runtime| {
            read_json_string(runtime, &[&["sessionId"][..], &["session_id"][..]])
        })
    });
    let source = read_json_string(document, &[&["source"][..]]).unwrap_or_else(|| {
        if projection_kind.eq_ignore_ascii_case("persona_generation") {
            "auxiliary.generate_persona".to_string()
        } else {
            "auxiliary.title_generation_result".to_string()
        }
    });
    let title = title_generation_result
        .and_then(|result| read_json_string(result, &[&["title"][..]]))
        .or_else(|| {
            persona_generation_result.and_then(|result| {
                read_json_string(
                    result,
                    &[
                        &["persona", "name"][..],
                        &["personaName"][..],
                        &["persona_name"][..],
                    ],
                )
            })
        });

    Some(json!({
        "artifactPath": artifact_path,
        "source": source,
        "projectionKind": projection_kind,
        "title": title,
        "sessionId": session_id,
        "usedFallback": title_generation_result.and_then(|result| {
            read_json_bool(result, &[&["usedFallback"][..], &["used_fallback"][..]])
        }),
        "fallbackReason": title_generation_result.and_then(|result| {
            read_json_string(
                result,
                &[&["fallbackReason"][..], &["fallback_reason"][..]]
            )
        }),
        "route": execution_runtime.as_ref().and_then(|runtime| {
            read_json_string(runtime, &[&["route"][..]])
        }),
        "runtimeSource": execution_runtime.as_ref().and_then(|runtime| {
            read_json_string(runtime, &[&["source"][..]])
        }),
        "taskKind": execution_runtime.as_ref().and_then(|runtime| {
            read_json_string(
                runtime,
                &[
                    &["task_profile", "kind"][..],
                    &["task_profile", "task_kind"][..],
                    &["taskProfile", "kind"][..],
                    &["taskProfile", "taskKind"][..],
                    &["task_kind"][..],
                    &["taskKind"][..],
                ]
            )
        }),
        "routingMode": execution_runtime.as_ref().and_then(|runtime| {
            read_json_string(
                runtime,
                &[
                    &["routing_decision", "routingMode"][..],
                    &["routing_decision", "routing_mode"][..],
                    &["routingDecision", "routingMode"][..],
                    &["routingDecision", "routing_mode"][..],
                    &["routing_mode"][..],
                    &["routingMode"][..],
                ]
            )
        }),
        "decisionSource": execution_runtime.as_ref().and_then(|runtime| {
            read_json_string(
                runtime,
                &[
                    &["routing_decision", "decisionSource"][..],
                    &["routing_decision", "decision_source"][..],
                    &["routingDecision", "decisionSource"][..],
                    &["routingDecision", "decision_source"][..],
                    &["decision_source"][..],
                    &["decisionSource"][..],
                ]
            )
        }),
        "estimatedCostClass": execution_runtime.as_ref().and_then(|runtime| {
            read_json_string(
                runtime,
                &[
                    &["cost_state", "estimatedCostClass"][..],
                    &["cost_state", "estimated_cost_class"][..],
                    &["costState", "estimatedCostClass"][..],
                    &["costState", "estimated_cost_class"][..],
                    &["estimated_cost_class"][..],
                    &["estimatedCostClass"][..],
                ]
            )
        }),
        "executionRuntime": execution_runtime
    }))
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

fn find_json_value_at_paths<'a>(value: &'a Value, paths: &[&[&str]]) -> Option<&'a Value> {
    for path in paths {
        if let Some(found) = find_json_value(value, path) {
            return Some(found);
        }
    }

    None
}

fn find_json_value<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    Some(current)
}

fn read_json_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    let resolved = find_json_value_at_paths(value, paths)?;
    match resolved {
        Value::String(text) => normalize_optional_text(Some(text.clone())),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn read_json_string_array(value: &Value, paths: &[&[&str]]) -> Vec<String> {
    let Some(resolved) = find_json_value_at_paths(value, paths) else {
        return Vec::new();
    };

    match resolved {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(text) => normalize_optional_text(Some(text.clone())),
                Value::Number(number) => Some(number.to_string()),
                _ => None,
            })
            .collect(),
        Value::String(text) => normalize_optional_text(Some(text.clone()))
            .map(|value| vec![value])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn read_json_bool(value: &Value, paths: &[&[&str]]) -> Option<bool> {
    find_json_value_at_paths(value, paths).and_then(Value::as_bool)
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
            file_checkpoint_summary: None,
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
            task_kind: Some("generation_topic".to_string()),
            service_model_slot: Some("planner".to_string()),
            routing_mode: Some("fallback_chain".to_string()),
            decision_source: Some("model_router".to_string()),
            candidate_count: Some(2),
            capability_gap: Some("vision".to_string()),
            single_candidate_only: Some(false),
            oem_policy: Some(json!({
                "quotaStatus": "low_credit",
                "defaultModel": "oem/gpt-5.4-mini",
                "offerState": "managed"
            })),
            runtime_summary: Some(json!({
                "decisionReason": "主路由能力不足，切到回退模型",
                "capabilityGap": "vision",
                "limitStatus": "soft_limited",
                "estimatedCostClass": "low"
            })),
            decision_reason: Some("主路由能力不足，切到回退模型".to_string()),
            fallback_chain: Some(vec![
                "openai:gpt-5.4".to_string(),
                "openai:gpt-5.4-mini".to_string(),
            ]),
            auxiliary_task_runtime: Some(vec![
                json!({"route": "auxiliary.generate_title", "taskKind": "generation_topic"}),
            ]),
            limit_state: Some(lime_agent::SessionExecutionRuntimeLimitState {
                status: "soft_limited".to_string(),
                single_candidate_only: false,
                provider_locked: false,
                settings_locked: false,
                oem_locked: false,
                candidate_count: 2,
                capability_gap: Some("vision".to_string()),
                notes: vec!["需要回退链".to_string()],
            }),
            estimated_cost_class: Some("low".to_string()),
            cost_state: Some(lime_agent::SessionExecutionRuntimeCostState {
                status: "estimated".to_string(),
                estimated_cost_class: Some("low".to_string()),
                input_per_million: None,
                output_per_million: None,
                cache_read_per_million: None,
                cache_write_per_million: None,
                currency: None,
                estimated_total_cost: None,
                input_tokens: None,
                output_tokens: None,
                total_tokens: None,
                cached_input_tokens: None,
                cache_creation_input_tokens: None,
            }),
            limit_event: Some(lime_agent::SessionExecutionRuntimeLimitEvent {
                event_kind: "fallback_applied".to_string(),
                message: "因能力缺口触发回退链".to_string(),
                retryable: true,
            }),
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

    fn write_image_task_fixture(root: &Path, relative_path: &str) {
        let absolute_path = root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
        fs::create_dir_all(
            absolute_path
                .parent()
                .expect("image task path should have parent"),
        )
        .expect("create image task dir");
        fs::write(
            absolute_path,
            serde_json::to_string_pretty(&json!({
                "task_id": "task-image-1",
                "task_type": "image_generate",
                "task_family": "image",
                "title": "城市夜景主视觉",
                    "summary": "城市夜景图片任务",
                    "payload": {
                        "prompt": "赛博朋克风城市夜景主视觉",
                        "provider_id": "openai",
                        "model": "gpt-image-1",
                        "modality_contract_key": IMAGE_GENERATION_CONTRACT_KEY,
                        "modality": "image",
                        "required_capabilities": ["text_generation", "image_generation", "vision_input"],
                        "routing_slot": IMAGE_GENERATION_ROUTING_SLOT,
                        "runtime_contract": {
                            "contract_key": IMAGE_GENERATION_CONTRACT_KEY,
                            "modality": "image",
                            "required_capabilities": ["text_generation", "image_generation", "vision_input"],
                            "routing_slot": IMAGE_GENERATION_ROUTING_SLOT,
                            "executor_binding": {
                                "executor_kind": "skill",
                                "binding_key": "image_generate"
                            },
                            "truth_source": ["image_task_artifact", "runtime_timeline_event"]
                        },
                        "title_generation_result": {
                            "title": "城市夜景主视觉",
                        "sessionId": "title-gen-1",
                        "usedFallback": false,
                        "fallbackReason": null,
                        "executionRuntime": {
                            "route": "auxiliary.generate_title",
                            "session_id": "title-gen-1",
                            "task_profile": {
                                "kind": "generation_topic",
                                "source": "auxiliary_generation_topic"
                            },
                            "routing_decision": {
                                "routingMode": "single_candidate",
                                "decisionSource": "service_model_setting",
                                "candidateCount": 1
                            },
                            "cost_state": {
                                "status": "estimated",
                                "estimatedCostClass": "low"
                            }
                        }
                    }
                },
                "status": "pending_submit",
                "normalized_status": "pending",
                "created_at": "2026-04-24T10:00:00Z",
                "updated_at": null,
                "submitted_at": null,
                "started_at": null,
                "completed_at": null,
                "cancelled_at": null,
                "idempotency_key": null,
                "retry_count": 0,
                "source_task_id": null,
                "result": null,
                "last_error": null,
                "current_attempt_id": "attempt-1",
                "attempts": [],
                "relationships": {},
                "progress": {},
                "ui_hints": {}
            }))
            .expect("serialize image task"),
        )
        .expect("write image task");
    }

    fn write_failed_image_contract_task_fixture(root: &Path, relative_path: &str) {
        let absolute_path = root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
        fs::create_dir_all(
            absolute_path
                .parent()
                .expect("image task path should have parent"),
        )
        .expect("create image task dir");
        fs::write(
            absolute_path,
            serde_json::to_string_pretty(&json!({
                "task_id": "task-image-failed",
                "task_type": "image_generate",
                "task_family": "image",
                "title": "图片模型路由失败",
                "summary": "图片任务被 contract preflight 阻止",
                "payload": {
                    "prompt": "生成一张产品海报",
                    "provider_id": "openai",
                    "model": "gpt-5.2",
                    "model_capability_assessment": {
                        "model_id": "gpt-5.2",
                        "provider_id": "openai",
                        "source": "model_registry",
                        "supports_image_generation": false,
                        "reason": "registry_missing_image_generation_capability"
                    },
                    "modality_contract_key": IMAGE_GENERATION_CONTRACT_KEY,
                    "modality": "image",
                    "required_capabilities": ["text_generation", "image_generation", "vision_input"],
                    "routing_slot": IMAGE_GENERATION_ROUTING_SLOT,
                    "runtime_contract": {
                        "contract_key": IMAGE_GENERATION_CONTRACT_KEY,
                        "modality": "image",
                        "required_capabilities": ["text_generation", "image_generation", "vision_input"],
                        "routing_slot": IMAGE_GENERATION_ROUTING_SLOT,
                        "executor_binding": {
                            "executor_kind": "skill",
                            "binding_key": "image_generate"
                        },
                        "truth_source": ["image_task_artifact", "runtime_timeline_event"]
                    }
                },
                "status": "failed",
                "normalized_status": "failed",
                "created_at": "2026-04-24T10:00:00Z",
                "updated_at": "2026-04-24T10:00:05Z",
                "submitted_at": null,
                "started_at": null,
                "completed_at": "2026-04-24T10:00:05Z",
                "cancelled_at": null,
                "idempotency_key": null,
                "retry_count": 0,
                "source_task_id": null,
                "result": null,
                "last_error": {
                    "code": "image_generation_model_capability_gap",
                    "message": "image_generation contract 要求图片生成模型，但当前模型 gpt-5.2 看起来是文本模型。",
                    "retryable": false,
                    "stage": "routing",
                    "provider_code": null,
                    "occurred_at": "2026-04-24T10:00:05Z"
                },
                "current_attempt_id": "attempt-1",
                "attempts": [],
                "relationships": {},
                "progress": {},
                "ui_hints": {}
            }))
            .expect("serialize failed image task"),
        )
        .expect("write failed image task");
    }

    fn write_audio_task_fixture(root: &Path, relative_path: &str) {
        let absolute_path = root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
        fs::create_dir_all(
            absolute_path
                .parent()
                .expect("audio task path should have parent"),
        )
        .expect("create audio task dir");
        fs::write(
            absolute_path,
            serde_json::to_string_pretty(&json!({
                "task_id": "task-audio-1",
                "task_type": "audio_generate",
                "task_family": "audio",
                "title": "发布旁白",
                "summary": "发布旁白音频任务",
                "payload": {
                    "prompt": "请为这段文案生成温暖旁白",
                    "source_text": "请为这段文案生成温暖旁白",
                    "voice": "warm_narrator",
                    "provider_id": "limecore",
                    "model": "voice-pro",
                    "entry_source": "at_voice_command",
                    "modality_contract_key": VOICE_GENERATION_CONTRACT_KEY,
                    "modality": "audio",
                    "required_capabilities": ["text_generation", "voice_generation"],
                    "routing_slot": VOICE_GENERATION_ROUTING_SLOT,
                    "runtime_contract": {
                        "contract_key": VOICE_GENERATION_CONTRACT_KEY,
                        "modality": "audio",
                        "required_capabilities": ["text_generation", "voice_generation"],
                        "routing_slot": VOICE_GENERATION_ROUTING_SLOT,
                        "executor_binding": {
                            "executor_kind": "service_skill",
                            "binding_key": "voice_runtime"
                        },
                        "truth_source": ["audio_task_artifact", "runtime_timeline_event"]
                    },
                    "audio_output": {
                        "kind": "audio_output",
                        "status": "pending",
                        "audio_path": null,
                        "mime_type": "audio/mpeg",
                        "duration_ms": null,
                        "source_text": "请为这段文案生成温暖旁白",
                        "voice": "warm_narrator"
                    }
                },
                "status": "pending_submit",
                "normalized_status": "pending",
                "created_at": "2026-04-30T10:00:00Z",
                "updated_at": null,
                "submitted_at": null,
                "started_at": null,
                "completed_at": null,
                "cancelled_at": null,
                "idempotency_key": null,
                "retry_count": 0,
                "source_task_id": null,
                "result": null,
                "last_error": null,
                "current_attempt_id": "attempt-audio-1",
                "attempts": [],
                "relationships": {},
                "progress": {},
                "ui_hints": {}
            }))
            .expect("serialize audio task"),
        )
        .expect("write audio task");
    }

    #[allow(dead_code)]
    fn write_auxiliary_runtime_projection_fixture(
        root: &Path,
        relative_path: &str,
        projection_kind: &str,
    ) {
        let absolute_path = root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
        fs::create_dir_all(
            absolute_path
                .parent()
                .expect("auxiliary projection path should have parent"),
        )
        .expect("create auxiliary projection dir");

        let document = if projection_kind == "persona_generation" {
            json!({
                "schemaVersion": 1,
                "artifactType": "auxiliary_runtime_projection",
                "projectionKind": "persona_generation",
                "source": "auxiliary.generate_persona",
                "parentSessionId": "session-1",
                "auxiliarySessionId": "persona-gen-1",
                "executionRuntime": {
                    "route": "auxiliary.generate_persona",
                    "session_id": "persona-gen-1",
                    "source": "runtime_snapshot",
                    "task_profile": {
                        "kind": "agent_meta",
                        "source": "auxiliary_agent_meta"
                    },
                    "routing_decision": {
                        "routingMode": "single_candidate",
                        "decisionSource": "service_model_setting",
                        "candidateCount": 1
                    },
                    "cost_state": {
                        "status": "estimated",
                        "estimatedCostClass": "low"
                    }
                },
                "personaGenerationResult": {
                    "sessionId": "persona-gen-1",
                    "persona": {
                        "name": "理性产品经理",
                        "description": "强调问题拆解与收益平衡",
                        "style": "结构化",
                        "tone": "克制",
                        "targetAudience": "团队负责人",
                        "forbiddenWords": ["绝对"],
                        "preferredWords": ["权衡"]
                    }
                }
            })
        } else {
            json!({
                "schemaVersion": 1,
                "artifactType": "auxiliary_runtime_projection",
                "projectionKind": "title_generation",
                "source": "auxiliary.title_generation_result",
                "parentSessionId": "session-1",
                "auxiliarySessionId": "title-gen-2",
                "executionRuntime": {
                    "route": "auxiliary.generate_title",
                    "session_id": "title-gen-2",
                    "source": "runtime_snapshot",
                    "task_profile": {
                        "kind": "topic",
                        "source": "auxiliary_title_generation"
                    },
                    "routing_decision": {
                        "routingMode": "single_candidate",
                        "decisionSource": "service_model_setting",
                        "candidateCount": 1
                    },
                    "cost_state": {
                        "status": "estimated",
                        "estimatedCostClass": "low"
                    }
                },
                "titleGenerationResult": {
                    "title": "多模型调度方案",
                    "sessionId": "title-gen-2",
                    "usedFallback": false,
                    "fallbackReason": null
                }
            })
        };

        fs::write(
            absolute_path,
            serde_json::to_string_pretty(&document).expect("serialize auxiliary projection"),
        )
        .expect("write auxiliary projection");
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
        assert_eq!(
            result
                .observability_summary
                .get("schemaVersion")
                .and_then(Value::as_str),
            Some("v1")
        );

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
        assert!(runtime.contains("\"fileCheckpointCount\": 1"));
        assert!(runtime.contains("\"fileCheckpoints\""));
        assert!(runtime.contains("\"checkpoint_id\": \"artifact-1\""));
        assert!(runtime.contains("\"path\": \".lime/artifacts/thread-1/report.md\""));
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
        assert!(artifacts.contains("\"fileCheckpointCount\": 1"));
        assert!(artifacts.contains("\"fileCheckpoints\""));
        assert!(artifacts.contains("\"checkpoint_id\": \"artifact-1\""));
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
        assert!(result
            .observability_summary
            .get("verificationSummary")
            .is_some());

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
        assert!(runtime.contains("\"outcome\": \"recovered\""));
        assert!(runtime.contains("\"outcome\": \"success\""));
        assert!(runtime.contains("\"focusVerificationRecoveredOutcomes\""));

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

    #[test]
    fn should_export_auxiliary_runtime_snapshots_from_image_task_artifact() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();
        let image_task_relative_path = ".lime/tasks/image_generate/task-image-1.json";

        write_request_telemetry_fixture(temp_dir.path());
        write_image_task_fixture(temp_dir.path(), image_task_relative_path);

        if let AgentThreadItemPayload::FileArtifact { path, metadata, .. } =
            &mut detail.items[1].payload
        {
            *path = image_task_relative_path.to_string();
            *metadata = Some(json!({
                "task_type": "image_generate"
            }));
        }

        let result =
            export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        assert!(result
            .known_gaps
            .iter()
            .all(|gap| !gap.contains("title_generation_result.execution_runtime")));

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let artifacts_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/artifacts.json");

        let runtime = serde_json::from_str::<Value>(
            fs::read_to_string(runtime_path).expect("runtime").as_str(),
        )
        .expect("parse runtime json");
        let runtime_snapshots = runtime
            .pointer("/auxiliaryRuntimeSnapshots/snapshots")
            .and_then(Value::as_array)
            .expect("runtime snapshots should exist");
        assert_eq!(
            runtime
                .pointer("/auxiliaryRuntimeSnapshots/applicableArtifactCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/auxiliaryRuntimeSnapshots/snapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/observabilitySummary/counts/auxiliaryRuntimeSnapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        let runtime_snapshot = runtime_snapshots
            .first()
            .expect("runtime snapshot should exist");
        assert_eq!(
            runtime_snapshot.get("artifactPath").and_then(Value::as_str),
            Some(image_task_relative_path)
        );
        assert_eq!(
            runtime_snapshot.get("source").and_then(Value::as_str),
            Some("image_task.title_generation_result")
        );
        assert_eq!(
            runtime_snapshot.get("title").and_then(Value::as_str),
            Some("城市夜景主视觉")
        );
        assert_eq!(
            runtime_snapshot.get("sessionId").and_then(Value::as_str),
            Some("title-gen-1")
        );
        assert_eq!(
            runtime_snapshot.get("route").and_then(Value::as_str),
            Some("auxiliary.generate_title")
        );
        assert_eq!(
            runtime_snapshot.get("taskKind").and_then(Value::as_str),
            Some("generation_topic")
        );
        assert_eq!(
            runtime_snapshot.get("routingMode").and_then(Value::as_str),
            Some("single_candidate")
        );
        assert_eq!(
            runtime_snapshot
                .get("decisionSource")
                .and_then(Value::as_str),
            Some("service_model_setting")
        );
        assert_eq!(
            runtime_snapshot
                .get("estimatedCostClass")
                .and_then(Value::as_str),
            Some("low")
        );
        assert_eq!(
            runtime
                .pointer("/observabilitySummary/signalCoverage")
                .and_then(Value::as_array)
                .and_then(|items| {
                    items.iter().find(|item| {
                        item.get("signal").and_then(Value::as_str) == Some("auxiliaryTaskRuntime")
                    })
                })
                .and_then(|item| item.get("status"))
                .and_then(Value::as_str),
            Some("exported")
        );

        let artifacts = serde_json::from_str::<Value>(
            fs::read_to_string(artifacts_path)
                .expect("artifacts")
                .as_str(),
        )
        .expect("parse artifacts json");
        assert_eq!(
            artifacts
                .pointer("/auxiliaryRuntimeSnapshots/snapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            artifacts
                .pointer("/auxiliaryRuntimeSnapshots/snapshots/0/route")
                .and_then(Value::as_str),
            Some("auxiliary.generate_title")
        );
    }

    #[test]
    fn should_export_modality_runtime_contract_snapshot_from_failed_image_task() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();
        let image_task_relative_path = ".lime/tasks/image_generate/task-image-failed.json";

        write_request_telemetry_fixture(temp_dir.path());
        write_failed_image_contract_task_fixture(temp_dir.path(), image_task_relative_path);

        if let AgentThreadItemPayload::FileArtifact { path, metadata, .. } =
            &mut detail.items[1].payload
        {
            *path = image_task_relative_path.to_string();
            *metadata = Some(json!({
                "task_type": "image_generate"
            }));
        }

        let result =
            export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        assert!(result
            .known_gaps
            .iter()
            .all(|gap| !gap.contains("ModalityRuntimeContract")));

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let artifacts_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/artifacts.json");

        let runtime = serde_json::from_str::<Value>(
            fs::read_to_string(runtime_path).expect("runtime").as_str(),
        )
        .expect("parse runtime json");
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/observabilitySummary/counts/modalityRuntimeContractCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(IMAGE_GENERATION_CONTRACT_KEY)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/model")
                .and_then(Value::as_str),
            Some("gpt-5.2")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("routing_not_possible")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingOutcome")
                .and_then(Value::as_str),
            Some("blocked")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/failureCode")
                .and_then(Value::as_str),
            Some("image_generation_model_capability_gap")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/modelCapabilityAssessment/source")
                .and_then(Value::as_str),
            Some("model_registry")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/modelCapabilityAssessment/supports_image_generation")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            runtime
                .pointer("/observabilitySummary/signalCoverage")
                .and_then(Value::as_array)
                .and_then(|items| {
                    items.iter().find(|item| {
                        item.get("signal").and_then(Value::as_str)
                            == Some("modalityRuntimeContract")
                    })
                })
                .and_then(|item| item.get("status"))
                .and_then(Value::as_str),
            Some("exported")
        );

        let artifacts = serde_json::from_str::<Value>(
            fs::read_to_string(artifacts_path)
                .expect("artifacts")
                .as_str(),
        )
        .expect("parse artifacts json");
        assert_eq!(
            artifacts
                .pointer("/modalityRuntimeContracts/snapshots/0/failureStage")
                .and_then(Value::as_str),
            Some("routing")
        );
        assert_eq!(
            artifacts
                .pointer("/modalityRuntimeContracts/snapshots/0/runtimeContract/contract_key")
                .and_then(Value::as_str),
            Some(IMAGE_GENERATION_CONTRACT_KEY)
        );
    }

    #[test]
    fn should_export_browser_control_contract_snapshot_from_tool_metadata() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "browser-contract-tool-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:40Z".to_string(),
            completed_at: Some("2026-03-27T10:00:40Z".to_string()),
            updated_at: "2026-03-27T10:00:40Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "mcp__lime-browser__navigate".to_string(),
                arguments: Some(json!({
                    "url": "https://example.com"
                })),
                output: Some("ok".to_string()),
                success: Some(true),
                error: None,
                metadata: Some(json!({
                    "tool_family": "browser",
                    "modality_contract_key": BROWSER_CONTROL_CONTRACT_KEY,
                    "modality": "browser",
                    "required_capabilities": [
                        "text_generation",
                        "browser_reasoning",
                        "browser_control_planning"
                    ],
                    "routing_slot": BROWSER_CONTROL_ROUTING_SLOT,
                    "runtime_contract": {
                        "contract_key": BROWSER_CONTROL_CONTRACT_KEY,
                        "routing_slot": BROWSER_CONTROL_ROUTING_SLOT
                    },
                    "entry_source": "at_browser_command"
                })),
            },
        });

        let result =
            export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        assert!(result
            .known_gaps
            .iter()
            .all(|gap| !gap.contains("ModalityRuntimeContract")));

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime = serde_json::from_str::<Value>(
            fs::read_to_string(runtime_path).expect("runtime").as_str(),
        )
        .expect("parse runtime json");

        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(BROWSER_CONTROL_CONTRACT_KEY)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("browser_action_trace.modality_runtime_contract")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("browser_action_requested")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingOutcome")
                .and_then(Value::as_str),
            Some("accepted")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/expectedRoutingSlot")
                .and_then(Value::as_str),
            Some(BROWSER_CONTROL_ROUTING_SLOT)
        );
    }

    #[test]
    fn should_export_pdf_extract_contract_snapshot_from_skill_metadata() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "pdf-contract-skill-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:40Z".to_string(),
            completed_at: Some("2026-03-27T10:00:40Z".to_string()),
            updated_at: "2026-03-27T10:00:40Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "Skill".to_string(),
                arguments: Some(json!({
                    "skill": "pdf_read",
                    "args": {
                        "pdf_read_request": {
                            "source_path": "/tmp/agent-report.pdf"
                        }
                    }
                })),
                output: Some("ok".to_string()),
                success: Some(true),
                error: None,
                metadata: Some(json!({
                    "modality_contract_key": PDF_EXTRACT_CONTRACT_KEY,
                    "modality": "document",
                    "required_capabilities": [
                        "text_generation",
                        "local_file_read",
                        "long_context"
                    ],
                    "routing_slot": PDF_EXTRACT_ROUTING_SLOT,
                    "runtime_contract": {
                        "contract_key": PDF_EXTRACT_CONTRACT_KEY,
                        "routing_slot": PDF_EXTRACT_ROUTING_SLOT,
                        "executor_binding": {
                            "executor_kind": "skill",
                            "binding_key": "pdf_read"
                        }
                    },
                    "entry_source": "at_pdf_read_command"
                })),
            },
        });

        let result =
            export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        assert!(result
            .known_gaps
            .iter()
            .all(|gap| !gap.contains("ModalityRuntimeContract")));

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime = serde_json::from_str::<Value>(
            fs::read_to_string(runtime_path).expect("runtime").as_str(),
        )
        .expect("parse runtime json");

        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(PDF_EXTRACT_CONTRACT_KEY)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("pdf_read_skill_trace.modality_runtime_contract")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("executor_invoked")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingOutcome")
                .and_then(Value::as_str),
            Some("accepted")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/expectedRoutingSlot")
                .and_then(Value::as_str),
            Some(PDF_EXTRACT_ROUTING_SLOT)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractMatchedExpected")
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn should_export_voice_generation_contract_snapshot_from_service_scene_trace() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "voice-contract-service-scene-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:40Z".to_string(),
            completed_at: Some("2026-03-27T10:00:40Z".to_string()),
            updated_at: "2026-03-27T10:00:40Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "voice_runtime".to_string(),
                arguments: Some(json!({
                    "service_scene_launch": {
                        "kind": "local_service_skill",
                        "service_scene_run": {
                            "skill_id": "voice-runtime",
                            "scene_key": "voice_runtime",
                            "user_input": "请为这段文案生成温暖旁白",
                            "entry_source": "at_voice_command",
                            "preferred_provider_id": "limecore",
                            "preferred_model_id": "voice-pro",
                            "modality_contract_key": VOICE_GENERATION_CONTRACT_KEY,
                            "modality": "audio",
                            "required_capabilities": [
                                "text_generation",
                                "voice_generation"
                            ],
                            "routing_slot": VOICE_GENERATION_ROUTING_SLOT,
                            "runtime_contract": {
                                "contract_key": VOICE_GENERATION_CONTRACT_KEY,
                                "routing_slot": VOICE_GENERATION_ROUTING_SLOT,
                                "executor_binding": {
                                    "executor_kind": "service_skill",
                                    "binding_key": "voice_runtime"
                                }
                            }
                        }
                    }
                })),
                output: Some("ok".to_string()),
                success: Some(true),
                error: None,
                metadata: None,
            },
        });

        export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime = serde_json::from_str::<Value>(
            fs::read_to_string(runtime_path).expect("runtime").as_str(),
        )
        .expect("parse runtime json");

        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(VOICE_GENERATION_CONTRACT_KEY)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("voice_generation_service_scene_trace.modality_runtime_contract")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("executor_invoked")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/expectedRoutingSlot")
                .and_then(Value::as_str),
            Some(VOICE_GENERATION_ROUTING_SLOT)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/entrySource")
                .and_then(Value::as_str),
            Some("at_voice_command")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/traceCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/executorBindingKey"
                )
                .and_then(Value::as_str),
            Some("voice_runtime")
        );
    }

    #[test]
    fn should_export_voice_generation_contract_snapshot_from_audio_task_artifact() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();
        let audio_task_relative_path = ".lime/tasks/audio_generate/task-audio-1.json";

        write_audio_task_fixture(temp_dir.path(), audio_task_relative_path);

        if let AgentThreadItemPayload::FileArtifact { path, metadata, .. } =
            &mut detail.items[1].payload
        {
            *path = audio_task_relative_path.to_string();
            *metadata = Some(json!({
                "task_type": "audio_generate"
            }));
        }

        export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime = serde_json::from_str::<Value>(
            fs::read_to_string(runtime_path).expect("runtime").as_str(),
        )
        .expect("parse runtime json");

        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("audio_task.modality_runtime_contract")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(VOICE_GENERATION_CONTRACT_KEY)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/taskType")
                .and_then(Value::as_str),
            Some("audio_generate")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/entrySource")
                .and_then(Value::as_str),
            Some("at_voice_command")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("executor_invoked")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/executorBindingKey")
                .and_then(Value::as_str),
            Some("voice_runtime")
        );
    }

    #[test]
    fn should_export_web_research_contract_snapshot_from_skill_args() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "web-research-contract-skill-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:40Z".to_string(),
            completed_at: Some("2026-03-27T10:00:40Z".to_string()),
            updated_at: "2026-03-27T10:00:40Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "Skill".to_string(),
                arguments: Some(json!({
                    "skill": "research",
                    "args": serde_json::to_string(&json!({
                        "research_request": {
                            "query": "AI Agent 融资",
                            "modality_contract_key": WEB_RESEARCH_CONTRACT_KEY,
                            "modality": "mixed",
                            "required_capabilities": [
                                "text_generation",
                                "web_search",
                                "structured_document_generation",
                                "long_context"
                            ],
                            "routing_slot": WEB_RESEARCH_ROUTING_SLOT,
                            "runtime_contract": {
                                "contract_key": WEB_RESEARCH_CONTRACT_KEY,
                                "routing_slot": WEB_RESEARCH_ROUTING_SLOT,
                                "executor_binding": {
                                    "executor_kind": "skill",
                                    "binding_key": "research"
                                }
                            },
                            "entry_source": "at_search_command"
                        }
                    })).expect("serialize args")
                })),
                output: Some("ok".to_string()),
                success: Some(true),
                error: None,
                metadata: None,
            },
        });

        let result =
            export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        assert!(result
            .known_gaps
            .iter()
            .all(|gap| !gap.contains("ModalityRuntimeContract")));

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime = serde_json::from_str::<Value>(
            fs::read_to_string(runtime_path).expect("runtime").as_str(),
        )
        .expect("parse runtime json");

        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(WEB_RESEARCH_CONTRACT_KEY)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("web_research_skill_trace.modality_runtime_contract")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("executor_invoked")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingOutcome")
                .and_then(Value::as_str),
            Some("accepted")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/expectedRoutingSlot")
                .and_then(Value::as_str),
            Some(WEB_RESEARCH_ROUTING_SLOT)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/contractKeys/0")
                .and_then(Value::as_str),
            Some(WEB_RESEARCH_CONTRACT_KEY)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/sourceCounts/0/source")
                .and_then(Value::as_str),
            Some("web_research_skill_trace.modality_runtime_contract")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/routingOutcomeCounts/0/outcome")
                .and_then(Value::as_str),
            Some("accepted")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/traceCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/entrySource",
                )
                .and_then(Value::as_str),
            Some("at_search_command")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/executorBindingKey",
                )
                .and_then(Value::as_str),
            Some("research")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractMatchedExpected")
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn should_export_web_research_contract_snapshot_from_report_skill_args() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "web-research-contract-report-skill-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:40Z".to_string(),
            completed_at: Some("2026-03-27T10:00:40Z".to_string()),
            updated_at: "2026-03-27T10:00:40Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "Skill".to_string(),
                arguments: Some(json!({
                    "skill": "report_generate",
                    "args": serde_json::to_string(&json!({
                        "report_request": {
                            "query": "AI Agent 融资",
                            "modality_contract_key": WEB_RESEARCH_CONTRACT_KEY,
                            "modality": "mixed",
                            "required_capabilities": [
                                "text_generation",
                                "web_search",
                                "structured_document_generation",
                                "long_context"
                            ],
                            "routing_slot": WEB_RESEARCH_ROUTING_SLOT,
                            "runtime_contract": {
                                "contract_key": WEB_RESEARCH_CONTRACT_KEY,
                                "routing_slot": WEB_RESEARCH_ROUTING_SLOT,
                                "executor_binding": {
                                    "executor_kind": "skill",
                                    "binding_key": "research"
                                }
                            },
                            "entry_source": "at_report_command"
                        }
                    })).expect("serialize args")
                })),
                output: Some("ok".to_string()),
                success: Some(true),
                error: None,
                metadata: None,
            },
        });

        export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime = serde_json::from_str::<Value>(
            fs::read_to_string(runtime_path).expect("runtime").as_str(),
        )
        .expect("parse runtime json");

        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(WEB_RESEARCH_CONTRACT_KEY)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/entrySource")
                .and_then(Value::as_str),
            Some("at_report_command")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/executorBindingKey")
                .and_then(Value::as_str),
            Some("research")
        );
    }

    #[test]
    fn should_export_text_transform_contract_snapshot_from_summary_skill_args() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "text-transform-contract-summary-skill-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:40Z".to_string(),
            completed_at: Some("2026-03-27T10:00:40Z".to_string()),
            updated_at: "2026-03-27T10:00:40Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "Skill".to_string(),
                arguments: Some(json!({
                    "skill": "summary",
                    "args": serde_json::to_string(&json!({
                        "summary_request": {
                            "content": "AI Agent 融资长文",
                            "modality_contract_key": TEXT_TRANSFORM_CONTRACT_KEY,
                            "modality": "document",
                            "required_capabilities": [
                                "text_generation",
                                "local_file_read",
                                "long_context"
                            ],
                            "routing_slot": TEXT_TRANSFORM_ROUTING_SLOT,
                            "runtime_contract": {
                                "contract_key": TEXT_TRANSFORM_CONTRACT_KEY,
                                "routing_slot": TEXT_TRANSFORM_ROUTING_SLOT,
                                "executor_binding": {
                                    "executor_kind": "skill",
                                    "binding_key": "text_transform"
                                }
                            },
                            "entry_source": "at_summary_command"
                        }
                    })).expect("serialize args")
                })),
                output: Some("ok".to_string()),
                success: Some(true),
                error: None,
                metadata: None,
            },
        });

        export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime = serde_json::from_str::<Value>(
            fs::read_to_string(runtime_path).expect("runtime").as_str(),
        )
        .expect("parse runtime json");

        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(TEXT_TRANSFORM_CONTRACT_KEY)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("text_transform_skill_trace.modality_runtime_contract")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/entrySource"
                )
                .and_then(Value::as_str),
            Some("at_summary_command")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/executorBindingKey")
                .and_then(Value::as_str),
            Some("text_transform")
        );
    }
}
