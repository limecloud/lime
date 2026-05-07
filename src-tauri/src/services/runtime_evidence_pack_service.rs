//! Runtime evidence pack 导出服务
//!
//! 将当前 Lime 会话的 runtime / timeline / artifact 事实，
//! 导出为最小可复盘的问题证据包。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use crate::commands::modality_runtime_contracts::{
    AUDIO_TRANSCRIPTION_CONTRACT_KEY, AUDIO_TRANSCRIPTION_LIMECORE_POLICY_REFS,
    AUDIO_TRANSCRIPTION_ROUTING_SLOT, BROWSER_CONTROL_CONTRACT_KEY,
    BROWSER_CONTROL_LIMECORE_POLICY_REFS, BROWSER_CONTROL_ROUTING_SLOT,
    IMAGE_GENERATION_CONTRACT_KEY, IMAGE_GENERATION_LIMECORE_POLICY_REFS,
    IMAGE_GENERATION_ROUTING_SLOT, LIMECORE_POLICY_DECISION_ALLOW,
    LIMECORE_POLICY_DECISION_REASON_NO_LOCAL_DENY,
    LIMECORE_POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY,
    LIMECORE_POLICY_DECISION_SOURCE_LOCAL_DEFAULT, LIMECORE_POLICY_INPUT_STATUS_DECLARED_ONLY,
    LIMECORE_POLICY_INPUT_STATUS_RESOLVED, LIMECORE_POLICY_INPUT_VALUE_SOURCE_LIMECORE_PENDING,
    LIMECORE_POLICY_SNAPSHOT_STATUS_LOCAL_DEFAULTS_EVALUATED,
    LIMECORE_POLICY_VALUE_HIT_STATUS_RESOLVED, PDF_EXTRACT_CONTRACT_KEY,
    PDF_EXTRACT_LIMECORE_POLICY_REFS, PDF_EXTRACT_ROUTING_SLOT, TEXT_TRANSFORM_CONTRACT_KEY,
    TEXT_TRANSFORM_LIMECORE_POLICY_REFS, TEXT_TRANSFORM_ROUTING_SLOT,
    VOICE_GENERATION_CONTRACT_KEY, VOICE_GENERATION_LIMECORE_POLICY_REFS,
    VOICE_GENERATION_ROUTING_SLOT, WEB_RESEARCH_CONTRACT_KEY, WEB_RESEARCH_LIMECORE_POLICY_REFS,
    WEB_RESEARCH_ROUTING_SLOT,
};
use crate::database::DbConnection;
use crate::services::artifact_document_validator::ARTIFACT_DOCUMENT_SCHEMA_VERSION;
use crate::services::runtime_file_checkpoint_service::list_file_checkpoints;
use crate::services::workspace_health_service::ensure_workspace_ready_with_auto_relocate;
use crate::workspace::WorkspaceManager;
use chrono::Utc;
use lime_core::database::dao::agent_run::AgentRun;
use lime_core::database::dao::agent_timeline::{AgentThreadItem, AgentThreadItemPayload};
use lime_infra::telemetry::RequestLog;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

const SESSION_RELATIVE_ROOT: &str = ".lime/harness/sessions";
const EVIDENCE_DIR_NAME: &str = "evidence";
const CAPABILITY_DRAFTS_RELATIVE_ROOT: &str = ".lime/capability-drafts";
const CONTROLLED_GET_EVIDENCE_DIR_NAME: &str = "controlled-get-evidence";
const CONTROLLED_GET_EVIDENCE_ARTIFACT_KIND: &str = "capability_draft_controlled_get_evidence";
const SUMMARY_FILE_NAME: &str = "summary.md";
const RUNTIME_FILE_NAME: &str = "runtime.json";
const TIMELINE_FILE_NAME: &str = "timeline.json";
const ARTIFACTS_FILE_NAME: &str = "artifacts.json";
const MAX_RECENT_ARTIFACTS: usize = 12;
const MAX_CONTROLLED_GET_EVIDENCE_ARTIFACTS: usize = 8;
const MAX_PREVIEW_CHARS: usize = 200;
const MAX_BROWSER_EVIDENCE_ITEMS: usize = 6;
const MAX_BROWSER_ACTION_OBSERVABILITY_ITEMS: usize = 5;
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
    pub completion_audit_summary: Value,
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

#[derive(Debug, Clone, Default, PartialEq)]
struct RuntimeCapabilityDraftControlledGetEvidenceSummary {
    scanned_artifact_count: usize,
    skipped_unsafe_artifact_count: usize,
    artifacts: Vec<Value>,
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
    export_runtime_evidence_pack_with_owner_runs(detail, thread_read, workspace_root, &[])
}

pub fn export_runtime_evidence_pack_with_owner_runs(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: &Path,
    owner_runs: &[AgentRun],
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
    let controlled_get_evidence =
        collect_capability_draft_controlled_get_evidence(workspace_root.as_path(), session_id);
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
    let known_gaps = build_known_gaps(&recent_artifacts, &signal_coverage, thread_read);
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
                &controlled_get_evidence,
                owner_runs,
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
                &controlled_get_evidence,
                owner_runs,
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
                &controlled_get_evidence,
                &request_telemetry,
                &verification,
                owner_runs,
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
        completion_audit_summary: build_completion_audit_summary_json(
            owner_runs,
            detail,
            &recent_artifact_paths,
            &controlled_get_evidence,
        ),
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
    let known_gaps = build_known_gaps(&recent_artifacts, &signal_coverage, thread_read);

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
    controlled_get_evidence: &RuntimeCapabilityDraftControlledGetEvidenceSummary,
    owner_runs: &[AgentRun],
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
    let _ = writeln!(
        markdown,
        "- 受控 GET evidence：{}",
        controlled_get_evidence.artifacts.len()
    );
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
    let _ = writeln!(
        markdown,
        "- 当前阻断信号：{}",
        format_observability_signal_list(observability_summary, "blocked")
    );
    let _ = writeln!(markdown);
    let completion_audit_summary = build_completion_audit_summary_json(
        owner_runs,
        detail,
        recent_artifacts,
        controlled_get_evidence,
    );
    let completion_decision = completion_audit_summary
        .get("decision")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let completion_blocking_reasons = completion_audit_summary
        .get("blockingReasons")
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
        .unwrap_or_else(|| "无".to_string());
    let _ = writeln!(markdown, "## Completion Audit");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 判定：`{completion_decision}`");
    let _ = writeln!(
        markdown,
        "- Automation owner：{} / {} success",
        completion_audit_summary
            .get("successfulOwnerRunCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        completion_audit_summary
            .get("ownerRunCount")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    );
    let _ = writeln!(
        markdown,
        "- Workspace Skill ToolCall evidence：{}",
        completion_audit_summary
            .get("workspaceSkillToolCallCount")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    );
    let _ = writeln!(
        markdown,
        "- Artifact evidence：{}",
        completion_audit_summary
            .get("artifactCount")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    );
    let _ = writeln!(
        markdown,
        "- 受控 GET evidence：{} / {} executed",
        completion_audit_summary
            .get("controlledGetEvidenceExecutedCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        completion_audit_summary
            .get("controlledGetEvidenceArtifactCount")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    );
    if !controlled_get_evidence.artifacts.is_empty() {
        let _ = writeln!(
            markdown,
            "- 受控 GET evidence artifact：{}",
            controlled_get_evidence.artifacts.len()
        );
    }
    let _ = writeln!(markdown, "- 阻塞原因：{completion_blocking_reasons}");
    let _ = writeln!(
        markdown,
        "- 审计原则：`success` run 只作为 audit input；`completed` 必须由 owner、ToolCall 与 artifact / timeline 证据共同判定。"
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
    controlled_get_evidence: &RuntimeCapabilityDraftControlledGetEvidenceSummary,
    owner_runs: &[AgentRun],
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
        "capabilityDraftControlledGetEvidence": build_capability_draft_controlled_get_evidence_json(
            controlled_get_evidence
        ),
        "automationOwners": build_automation_owner_runs_json(owner_runs),
        "completionAuditSummary": build_completion_audit_summary_json(
            owner_runs,
            detail,
            recent_artifacts,
            controlled_get_evidence
        ),
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
            let mut item_json = json!({
                "id": item.id,
                "turnId": item.turn_id,
                "sequence": item.sequence,
                "status": serialize_enum_as_string(&item.status, "unknown"),
                "payloadKind": payload_kind,
                "payloadSummary": payload_summary,
                "updatedAt": item.updated_at
            });
            if let Some(workspace_skill_tool_call) =
                build_workspace_skill_tool_call_timeline_json(&item.payload)
            {
                if let Some(object) = item_json.as_object_mut() {
                    object.insert(
                        "workspaceSkillToolCall".to_string(),
                        workspace_skill_tool_call,
                    );
                }
            }
            item_json
        }).collect::<Vec<_>>()
    });

    serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 timeline.json 失败: {error}"))
}

fn build_workspace_skill_tool_call_timeline_json(
    payload: &AgentThreadItemPayload,
) -> Option<Value> {
    let AgentThreadItemPayload::ToolCall {
        tool_name,
        success,
        metadata,
        ..
    } = payload
    else {
        return None;
    };

    let metadata = metadata.as_ref()?;
    let workspace_skill_source = metadata.get("workspace_skill_source").cloned();
    let workspace_skill_runtime_enable = metadata.get("workspace_skill_runtime_enable").cloned();
    if workspace_skill_source.is_none() && workspace_skill_runtime_enable.is_none() {
        return None;
    }

    Some(json!({
        "toolName": tool_name,
        "success": success,
        "workspaceSkillSource": workspace_skill_source,
        "workspaceSkillRuntimeEnable": workspace_skill_runtime_enable
    }))
}

fn build_artifacts_json(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    recent_artifacts: &[String],
    file_checkpoints: &[crate::commands::aster_agent_cmd::AgentRuntimeFileCheckpointSummary],
    auxiliary_runtime: &RuntimeAuxiliaryRuntimeSnapshotSummary,
    modality_runtime_contracts: &RuntimeModalityContractSnapshotSummary,
    observability_summary: &Value,
    controlled_get_evidence: &RuntimeCapabilityDraftControlledGetEvidenceSummary,
    request_telemetry: &RuntimeRequestTelemetrySummary,
    verification: &RuntimeEvidenceVerificationSummary,
    owner_runs: &[AgentRun],
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
        "capabilityDraftControlledGetEvidence": build_capability_draft_controlled_get_evidence_json(
            controlled_get_evidence
        ),
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
        "automationOwners": build_automation_owner_runs_json(owner_runs),
        "completionAuditSummary": build_completion_audit_summary_json(
            owner_runs,
            detail,
            recent_artifacts,
            controlled_get_evidence
        ),
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

fn parse_agent_run_metadata(run: &AgentRun) -> Option<Value> {
    run.metadata
        .as_deref()
        .and_then(|metadata| serde_json::from_str::<Value>(metadata).ok())
        .filter(Value::is_object)
}

fn build_automation_owner_runs_json(owner_runs: &[AgentRun]) -> Value {
    let runs = owner_runs
        .iter()
        .filter(|run| run.source == "automation")
        .map(|run| {
            let metadata = parse_agent_run_metadata(run);
            json!({
                "runId": run.id,
                "source": run.source,
                "sourceRef": run.source_ref,
                "sessionId": run.session_id,
                "status": run.status.as_str(),
                "startedAt": run.started_at,
                "finishedAt": run.finished_at,
                "durationMs": run.duration_ms,
                "jobId": metadata
                    .as_ref()
                    .and_then(|value| value.get("job_id"))
                    .cloned()
                    .or_else(|| run.source_ref.as_ref().map(|value| json!(value))),
                "jobName": metadata
                    .as_ref()
                    .and_then(|value| value.get("job_name"))
                    .cloned(),
                "agentEnvelope": metadata
                    .as_ref()
                    .and_then(|value| value.pointer("/harness/agent_envelope"))
                    .cloned(),
                "managedObjective": metadata
                    .as_ref()
                    .and_then(|value| value.pointer("/harness/managed_objective"))
                    .cloned(),
                "workspaceSkillRuntimeEnable": metadata
                    .as_ref()
                    .and_then(|value| value.pointer("/harness/workspace_skill_runtime_enable"))
                    .cloned(),
                "completionAudit": build_automation_owner_completion_audit_json(run, metadata.as_ref()),
                "metadata": metadata,
            })
        })
        .collect::<Vec<_>>();

    json!({
        "source": "agent_runs",
        "ownerType": "automation_job",
        "count": runs.len(),
        "runs": runs,
    })
}

fn build_automation_owner_completion_audit_json(run: &AgentRun, metadata: Option<&Value>) -> Value {
    let agent_envelope = metadata
        .and_then(|value| value.pointer("/harness/agent_envelope"))
        .filter(|value| value.is_object());
    let managed_objective = metadata
        .and_then(|value| value.pointer("/harness/managed_objective"))
        .filter(|value| value.is_object());
    let workspace_skill_runtime_enable = metadata
        .and_then(|value| value.pointer("/harness/workspace_skill_runtime_enable"))
        .filter(|value| value.is_object());
    let has_artifact_or_evidence_requirement = managed_objective
        .and_then(|value| value.get("completion_audit"))
        .and_then(Value::as_str)
        .map(|value| value == "artifact_or_evidence_required")
        .unwrap_or(false);

    let mut missing_inputs = Vec::new();
    if agent_envelope.is_none() {
        missing_inputs.push("agent_envelope");
    }
    if managed_objective.is_none() {
        missing_inputs.push("managed_objective");
    }
    if workspace_skill_runtime_enable.is_none() {
        missing_inputs.push("workspace_skill_runtime_enable");
    }
    if !has_artifact_or_evidence_requirement {
        missing_inputs.push("managed_objective.completion_audit");
    }

    let audit_status = if run.status.as_str() != "success" {
        "blocked_by_run_status"
    } else if missing_inputs.is_empty() {
        "audit_input_ready"
    } else {
        "missing_inputs"
    };

    json!({
        "source": "automation_owner_run",
        "status": audit_status,
        "runStatus": run.status.as_str(),
        "completionDecision": "not_completed",
        "requiresArtifactOrEvidence": has_artifact_or_evidence_requirement,
        "missingInputs": missing_inputs,
        "evidenceInputs": {
            "agentEnvelope": agent_envelope.is_some(),
            "managedObjective": managed_objective.is_some(),
            "workspaceSkillRuntimeEnable": workspace_skill_runtime_enable.is_some(),
        },
        "note": "automation success 只提供 completion audit 输入；completed 必须由 artifact / timeline / evidence 审计产生。"
    })
}

fn build_completion_audit_summary_json(
    owner_runs: &[AgentRun],
    detail: &SessionDetail,
    recent_artifacts: &[String],
    controlled_get_evidence: &RuntimeCapabilityDraftControlledGetEvidenceSummary,
) -> Value {
    let automation_owner_runs = owner_runs
        .iter()
        .filter(|run| run.source == "automation")
        .collect::<Vec<_>>();
    let owner_run_count = automation_owner_runs.len();
    let successful_owner_run_count = automation_owner_runs
        .iter()
        .filter(|run| run.status.as_str() == "success")
        .count();
    let workspace_skill_tool_call_count = detail
        .items
        .iter()
        .filter(|item| is_successful_workspace_skill_tool_call(&item.payload))
        .count();
    let artifact_count = recent_artifacts.len();
    let controlled_get_evidence_artifact_count = controlled_get_evidence.artifacts.len();
    let controlled_get_evidence_executed_count = controlled_get_evidence
        .artifacts
        .iter()
        .filter(|artifact| is_executed_controlled_get_evidence_summary_artifact(artifact))
        .count();
    let controlled_get_evidence_status_counts =
        build_controlled_get_evidence_status_counts(controlled_get_evidence);

    let mut owner_audit_statuses = Vec::new();
    let mut has_blocked_owner_run = false;
    let mut has_missing_owner_inputs = false;
    let mut has_controlled_get_evidence_requirement = false;
    for run in &automation_owner_runs {
        let metadata = parse_agent_run_metadata(run);
        let audit = build_automation_owner_completion_audit_json(run, metadata.as_ref());
        if let Some(status) = audit.get("status").and_then(Value::as_str) {
            owner_audit_statuses.push(status.to_string());
            has_blocked_owner_run |= status == "blocked_by_run_status";
            has_missing_owner_inputs |= status == "missing_inputs";
        }
        has_controlled_get_evidence_requirement |=
            requires_controlled_get_evidence(metadata.as_ref());
    }

    let has_automation_owner = owner_run_count > 0;
    let has_successful_owner = successful_owner_run_count > 0;
    let has_workspace_skill_tool_call = workspace_skill_tool_call_count > 0;
    let has_artifact_or_timeline = artifact_count > 0 || has_workspace_skill_tool_call;
    let has_controlled_get_evidence = controlled_get_evidence_executed_count > 0;

    let mut blocking_reasons = Vec::new();
    if !has_automation_owner {
        blocking_reasons.push("missing_automation_owner");
    }
    if has_automation_owner && !has_successful_owner {
        blocking_reasons.push("missing_successful_automation_owner");
    }
    if has_blocked_owner_run {
        blocking_reasons.push("blocked_by_automation_owner_run_status");
    }
    if has_missing_owner_inputs {
        blocking_reasons.push("missing_automation_owner_audit_inputs");
    }
    if has_successful_owner && !has_workspace_skill_tool_call {
        blocking_reasons.push("missing_workspace_skill_tool_call_evidence");
    }
    if has_successful_owner && !has_artifact_or_timeline {
        blocking_reasons.push("missing_artifact_or_timeline_evidence");
    }
    if has_successful_owner
        && has_controlled_get_evidence_requirement
        && !has_controlled_get_evidence
    {
        blocking_reasons.push("missing_controlled_get_evidence");
    }

    let decision = if !has_automation_owner {
        "needs_input"
    } else if has_blocked_owner_run || (has_automation_owner && !has_successful_owner) {
        "blocked"
    } else if has_missing_owner_inputs {
        "needs_input"
    } else if has_successful_owner
        && has_workspace_skill_tool_call
        && has_artifact_or_timeline
        && (!has_controlled_get_evidence_requirement || has_controlled_get_evidence)
    {
        "completed"
    } else {
        "verifying"
    };

    let mut notes = vec![
        "completed 只由 automation owner、workspace skill tool call、artifact/timeline 证据共同判定，不读取模型自报。"
            .to_string(),
    ];
    if decision == "completed" {
        notes.push(
            "automation success 已被提升为 completion audit 输入，并由 evidence pack 完成审计。"
                .to_string(),
        );
    } else {
        notes.push(
            "automation success 仍停留在 verifying / audit input，需补齐证据后才能 completed。"
                .to_string(),
        );
    }
    if has_controlled_get_evidence {
        notes.push(
            "受控 GET evidence 已纳入 completion audit 可见输入，但不能单独触发 completed。"
                .to_string(),
        );
    } else if has_controlled_get_evidence_requirement {
        notes.push(
            "当前目标要求受控 GET evidence；缺少 executed evidence 时不能 completed。".to_string(),
        );
    } else {
        notes.push(
            "当前没有可计入审计输入的 executed 受控 GET evidence；该信号暂不作为通用 completed 阻断项。"
                .to_string(),
        );
    }

    json!({
        "source": "runtime_evidence_pack_completion_audit",
        "decision": decision,
        "ownerRunCount": owner_run_count,
        "successfulOwnerRunCount": successful_owner_run_count,
        "workspaceSkillToolCallCount": workspace_skill_tool_call_count,
        "artifactCount": artifact_count,
        "controlledGetEvidenceArtifactCount": controlled_get_evidence_artifact_count,
        "controlledGetEvidenceExecutedCount": controlled_get_evidence_executed_count,
        "controlledGetEvidenceScannedArtifactCount": controlled_get_evidence.scanned_artifact_count,
        "controlledGetEvidenceSkippedUnsafeArtifactCount": controlled_get_evidence.skipped_unsafe_artifact_count,
        "controlledGetEvidenceStatusCounts": controlled_get_evidence_status_counts,
        "controlledGetEvidenceRequired": has_controlled_get_evidence_requirement,
        "ownerAuditStatuses": owner_audit_statuses,
        "requiredEvidence": {
            "automationOwner": has_successful_owner,
            "workspaceSkillToolCall": has_workspace_skill_tool_call,
            "artifactOrTimeline": has_artifact_or_timeline,
            "controlledGetEvidence": has_controlled_get_evidence,
        },
        "blockingReasons": blocking_reasons,
        "notes": notes,
    })
}

fn requires_controlled_get_evidence(metadata: Option<&Value>) -> bool {
    let Some(metadata) = metadata else {
        return false;
    };
    let Some(managed_objective) = metadata
        .pointer("/harness/managed_objective")
        .filter(|value| value.is_object())
    else {
        return false;
    };

    let completion_policy = managed_objective
        .get("completion_evidence_policy")
        .filter(|value| value.is_object());
    let explicit_policy_required = completion_policy
        .and_then(|value| value.get("controlled_get_evidence_required"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let objective_required = managed_objective
        .get("controlled_get_evidence_required")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let external_evidence_required = managed_objective
        .get("required_external_evidence")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .any(is_controlled_get_evidence_requirement)
        })
        .unwrap_or(false);

    explicit_policy_required || objective_required || external_evidence_required
}

fn is_controlled_get_evidence_requirement(value: &str) -> bool {
    matches!(
        value.trim(),
        "controlled_get"
            | "controlled_get_evidence"
            | "capability_draft_controlled_get_evidence"
            | "readonly_http_controlled_get_execution"
    )
}

fn is_executed_controlled_get_evidence_summary_artifact(artifact: &Value) -> bool {
    artifact.get("status").and_then(Value::as_str) == Some("executed")
        && artifact
            .get("networkRequestSent")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        && artifact
            .get("responseCaptured")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        && artifact
            .get("requestUrlHash")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .is_some()
        && artifact
            .get("responseSha256")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .is_some()
}

fn build_controlled_get_evidence_status_counts(
    summary: &RuntimeCapabilityDraftControlledGetEvidenceSummary,
) -> BTreeMap<String, usize> {
    let mut status_counts = BTreeMap::<String, usize>::new();
    for artifact in &summary.artifacts {
        let status = artifact
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        *status_counts.entry(status.to_string()).or_insert(0) += 1;
    }
    status_counts
}

fn is_successful_workspace_skill_tool_call(payload: &AgentThreadItemPayload) -> bool {
    let AgentThreadItemPayload::ToolCall {
        success, metadata, ..
    } = payload
    else {
        return false;
    };

    if *success != Some(true) {
        return false;
    }

    metadata
        .as_ref()
        .map(|value| {
            value.get("workspace_skill_source").is_some()
                || value.get("workspace_skill_runtime_enable").is_some()
        })
        .unwrap_or(false)
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

fn build_modality_runtime_contracts_observability_summary_json(
    summary: &RuntimeModalityContractSnapshotSummary,
) -> Value {
    let snapshot_index = build_modality_runtime_contract_snapshot_index(&summary.snapshots);
    let task_index = snapshot_index.get("taskIndex").cloned().unwrap_or_else(|| {
        json!({
            "snapshotCount": 0,
            "threadIds": [],
            "turnIds": [],
            "contentIds": [],
            "entryKeys": [],
            "modalities": [],
            "skillIds": [],
            "modelIds": [],
            "executorKinds": [],
            "executorBindingKeys": [],
            "costStates": [],
            "limitStates": [],
            "estimatedCostClasses": [],
            "limitEventKinds": [],
            "quotaLowCount": 0,
            "items": []
        })
    });
    let browser_action_index = snapshot_index
        .get("browserActionIndex")
        .cloned()
        .map(compact_browser_action_index_for_observability)
        .unwrap_or_else(|| {
            json!({
                "actionCount": 0,
                "sessionCount": 0,
                "observationCount": 0,
                "screenshotCount": 0,
                "lastUrl": null,
                "sessionIds": [],
                "targetIds": [],
                "profileKeys": [],
                "statusCounts": [],
                "artifactKindCounts": [],
                "actionCounts": [],
                "backendCounts": [],
                "items": []
            })
        });
    let limecore_policy_index = snapshot_index
        .get("limecorePolicyIndex")
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "snapshotCount": 0,
                "refKeys": [],
                "statusCounts": [],
                "decisionCounts": [],
                "items": []
            })
        });

    json!({
        "snapshotCount": summary.snapshots.len(),
        "snapshotIndex": {
            "taskIndex": task_index,
            "browserActionIndex": browser_action_index,
            "limecorePolicyIndex": limecore_policy_index
        }
    })
}

fn compact_browser_action_index_for_observability(mut index: Value) -> Value {
    if let Some(items) = index.get_mut("items").and_then(Value::as_array_mut) {
        if items.len() > MAX_BROWSER_ACTION_OBSERVABILITY_ITEMS {
            let keep_from = items.len() - MAX_BROWSER_ACTION_OBSERVABILITY_ITEMS;
            *items = items.split_off(keep_from);
        }
    }

    index
}

fn build_modality_runtime_contract_snapshot_index(snapshots: &[Value]) -> Value {
    let mut contract_keys = BTreeSet::new();
    let mut sources: BTreeMap<String, usize> = BTreeMap::new();
    let mut routing_outcomes: BTreeMap<String, usize> = BTreeMap::new();
    let mut expected_routing_slots = BTreeSet::new();
    let mut execution_profile_keys = BTreeSet::new();
    let mut executor_adapter_keys = BTreeSet::new();
    let mut task_thread_ids = BTreeSet::new();
    let mut task_turn_ids = BTreeSet::new();
    let mut task_content_ids = BTreeSet::new();
    let mut task_entry_keys = BTreeSet::new();
    let mut task_modalities = BTreeSet::new();
    let mut task_skill_ids = BTreeSet::new();
    let mut task_model_ids = BTreeSet::new();
    let mut task_executor_kinds = BTreeSet::new();
    let mut task_executor_binding_keys = BTreeSet::new();
    let mut task_cost_states = BTreeSet::new();
    let mut task_limit_states = BTreeSet::new();
    let mut task_estimated_cost_classes = BTreeSet::new();
    let mut task_limit_event_kinds = BTreeSet::new();
    let mut task_quota_low_count = 0usize;
    let mut task_index_items = Vec::new();
    let mut limecore_policy_refs = BTreeSet::new();
    let mut limecore_policy_missing_inputs = BTreeSet::new();
    let mut limecore_policy_pending_hit_refs = BTreeSet::new();
    let mut limecore_policy_value_hit_count = 0usize;
    let mut limecore_policy_statuses: BTreeMap<String, usize> = BTreeMap::new();
    let mut limecore_policy_decisions: BTreeMap<String, usize> = BTreeMap::new();
    let mut limecore_policy_items = Vec::new();
    let mut trace_items = Vec::new();
    let mut audio_output_statuses: BTreeMap<String, usize> = BTreeMap::new();
    let mut audio_output_error_codes = BTreeSet::new();
    let mut audio_output_items = Vec::new();
    let mut transcript_statuses: BTreeMap<String, usize> = BTreeMap::new();
    let mut transcript_error_codes = BTreeSet::new();
    let mut transcript_items = Vec::new();
    let mut browser_action_statuses: BTreeMap<String, usize> = BTreeMap::new();
    let mut browser_action_kinds: BTreeMap<String, usize> = BTreeMap::new();
    let mut browser_action_names: BTreeMap<String, usize> = BTreeMap::new();
    let mut browser_session_ids = BTreeSet::new();
    let mut browser_target_ids = BTreeSet::new();
    let mut browser_profile_keys = BTreeSet::new();
    let mut browser_backends: BTreeMap<String, usize> = BTreeMap::new();
    let mut browser_last_url = None;
    let mut browser_observation_count = 0usize;
    let mut browser_screenshot_count = 0usize;
    let mut browser_action_items = Vec::new();

    for snapshot in snapshots {
        let contract_key = snapshot_string(snapshot, "contractKey");
        let source = snapshot_string(snapshot, "source");
        let routing_outcome = snapshot_string(snapshot, "routingOutcome");
        let expected_routing_slot = snapshot_string(snapshot, "expectedRoutingSlot");
        let execution_profile_key = snapshot_string(snapshot, "executionProfileKey");
        let executor_adapter_key = snapshot_string(snapshot, "executorAdapterKey");
        let thread_id = snapshot_string(snapshot, "threadId");
        let turn_id = snapshot_string(snapshot, "turnId");
        let content_id = snapshot_string(snapshot, "contentId");
        let entry_key = snapshot_string(snapshot, "entryKey")
            .or_else(|| snapshot_string(snapshot, "entrySource"));
        let modality = snapshot_string(snapshot, "modality");
        let skill_id = snapshot_string(snapshot, "skillId");
        let model_id =
            snapshot_string(snapshot, "modelId").or_else(|| snapshot_string(snapshot, "model"));
        let executor_kind = snapshot_string(snapshot, "executorKind");
        let executor_binding_key = snapshot_string(snapshot, "executorBindingKey");
        let cost_state = snapshot_string(snapshot, "costState");
        let limit_state = snapshot_string(snapshot, "limitState");
        let estimated_cost_class = snapshot_string(snapshot, "estimatedCostClass");
        let limit_event_kind = snapshot_string(snapshot, "limitEventKind");
        let quota_low = snapshot.get("quotaLow").and_then(Value::as_bool);
        let snapshot_limecore_policy_refs =
            read_json_string_array(snapshot, &[&["limecorePolicyRefs"][..]]);
        let limecore_policy_snapshot = snapshot
            .get("limecorePolicySnapshot")
            .filter(|value| value.is_object());

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
        if let Some(execution_profile_key) = execution_profile_key.as_deref() {
            execution_profile_keys.insert(execution_profile_key.to_string());
        }
        if let Some(executor_adapter_key) = executor_adapter_key.as_deref() {
            executor_adapter_keys.insert(executor_adapter_key.to_string());
        }
        if let Some(value) = thread_id.as_deref() {
            task_thread_ids.insert(value.to_string());
        }
        if let Some(value) = turn_id.as_deref() {
            task_turn_ids.insert(value.to_string());
        }
        if let Some(value) = content_id.as_deref() {
            task_content_ids.insert(value.to_string());
        }
        if let Some(value) = entry_key.as_deref() {
            task_entry_keys.insert(value.to_string());
        }
        if let Some(value) = modality.as_deref() {
            task_modalities.insert(value.to_string());
        }
        if let Some(value) = skill_id.as_deref() {
            task_skill_ids.insert(value.to_string());
        }
        if let Some(value) = model_id.as_deref() {
            task_model_ids.insert(value.to_string());
        }
        if let Some(value) = executor_kind.as_deref() {
            task_executor_kinds.insert(value.to_string());
        }
        if let Some(value) = executor_binding_key.as_deref() {
            task_executor_binding_keys.insert(value.to_string());
        }
        if let Some(value) = cost_state.as_deref() {
            task_cost_states.insert(value.to_string());
        }
        if let Some(value) = limit_state.as_deref() {
            task_limit_states.insert(value.to_string());
        }
        if let Some(value) = estimated_cost_class.as_deref() {
            task_estimated_cost_classes.insert(value.to_string());
        }
        if let Some(value) = limit_event_kind.as_deref() {
            task_limit_event_kinds.insert(value.to_string());
        }
        if quota_low == Some(true) {
            task_quota_low_count += 1;
        }
        task_index_items.push(json!({
            "artifactPath": snapshot.get("artifactPath").cloned().unwrap_or(Value::Null),
            "taskId": snapshot.get("taskId").cloned().unwrap_or(Value::Null),
            "taskType": snapshot.get("taskType").cloned().unwrap_or(Value::Null),
            "contractKey": contract_key.clone(),
            "source": source.clone(),
            "threadId": thread_id,
            "turnId": turn_id,
            "contentId": content_id,
            "entryKey": entry_key,
            "entrySource": snapshot.get("entrySource").cloned().unwrap_or(Value::Null),
            "modality": modality,
            "skillId": skill_id,
            "modelId": model_id,
            "executorKind": executor_kind,
            "executorBindingKey": executor_binding_key,
            "costState": cost_state,
            "limitState": limit_state,
            "estimatedCostClass": estimated_cost_class,
            "limitEventKind": limit_event_kind,
            "quotaLow": quota_low,
            "routingOutcome": snapshot.get("routingOutcome").cloned().unwrap_or(Value::Null),
        }));
        for policy_ref in &snapshot_limecore_policy_refs {
            limecore_policy_refs.insert(policy_ref.to_string());
        }
        if !snapshot_limecore_policy_refs.is_empty() || limecore_policy_snapshot.is_some() {
            let status = limecore_policy_snapshot
                .and_then(|value| snapshot_string(value, "status"))
                .unwrap_or_else(|| {
                    LIMECORE_POLICY_SNAPSHOT_STATUS_LOCAL_DEFAULTS_EVALUATED.to_string()
                });
            let decision = limecore_policy_snapshot
                .and_then(|value| snapshot_string(value, "decision"))
                .unwrap_or_else(|| LIMECORE_POLICY_DECISION_ALLOW.to_string());
            let decision_source = limecore_policy_snapshot
                .and_then(|value| {
                    read_json_string(value, &[&["decision_source"][..], &["decisionSource"][..]])
                })
                .unwrap_or_else(|| LIMECORE_POLICY_DECISION_SOURCE_LOCAL_DEFAULT.to_string());
            let decision_scope = limecore_policy_snapshot
                .and_then(|value| {
                    read_json_string(value, &[&["decision_scope"][..], &["decisionScope"][..]])
                })
                .unwrap_or_else(|| LIMECORE_POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY.to_string());
            let decision_reason = limecore_policy_snapshot
                .and_then(|value| {
                    read_json_string(value, &[&["decision_reason"][..], &["decisionReason"][..]])
                })
                .unwrap_or_else(|| LIMECORE_POLICY_DECISION_REASON_NO_LOCAL_DENY.to_string());
            let policy_evaluation = limecore_policy_snapshot
                .and_then(|value| {
                    value
                        .get("policy_evaluation")
                        .or_else(|| value.get("policyEvaluation"))
                        .filter(|item| item.is_object())
                        .cloned()
                })
                .unwrap_or(Value::Null);
            let policy_value_hits = limecore_policy_snapshot
                .and_then(|value| {
                    value
                        .get("policy_value_hits")
                        .or_else(|| value.get("policyValueHits"))
                        .filter(|item| item.is_array())
                        .cloned()
                })
                .unwrap_or_else(|| json!([]));
            let resolved_hit_refs = limecore_policy_resolved_hit_refs(&policy_value_hits);
            let mut unresolved_refs = limecore_policy_snapshot
                .map(|value| {
                    read_json_string_array(
                        value,
                        &[&["unresolved_refs"][..], &["unresolvedRefs"][..]],
                    )
                })
                .unwrap_or_default();
            if unresolved_refs.is_empty() {
                unresolved_refs = limecore_policy_refs_without_resolved_hits(
                    &snapshot_limecore_policy_refs,
                    &resolved_hit_refs,
                );
            }
            let policy_inputs = limecore_policy_snapshot
                .and_then(|value| {
                    value
                        .get("policy_inputs")
                        .or_else(|| value.get("policyInputs"))
                        .filter(|item| item.is_array())
                        .cloned()
                })
                .unwrap_or_else(|| {
                    build_limecore_policy_inputs_value_with_hits(
                        &snapshot_limecore_policy_refs,
                        &policy_value_hits,
                    )
                });
            let mut missing_inputs = limecore_policy_snapshot
                .map(|value| {
                    read_json_string_array(
                        value,
                        &[&["missing_inputs"][..], &["missingInputs"][..]],
                    )
                })
                .unwrap_or_default();
            if missing_inputs.is_empty() {
                missing_inputs = unresolved_refs.clone();
            }
            if missing_inputs.is_empty() {
                missing_inputs = limecore_policy_refs_without_resolved_hits(
                    &snapshot_limecore_policy_refs,
                    &resolved_hit_refs,
                );
            }
            for missing_input in &missing_inputs {
                limecore_policy_missing_inputs.insert(missing_input.to_string());
            }
            let policy_value_hit_count = limecore_policy_snapshot
                .and_then(|value| {
                    read_json_usize(
                        value,
                        &[
                            &["policy_value_hit_count"][..],
                            &["policyValueHitCount"][..],
                        ],
                    )
                })
                .unwrap_or_else(|| {
                    policy_value_hits
                        .as_array()
                        .map(|items| items.len())
                        .unwrap_or_default()
                });
            limecore_policy_value_hit_count += policy_value_hit_count;
            let mut pending_hit_refs = limecore_policy_snapshot
                .map(|value| {
                    read_json_string_array(
                        value,
                        &[&["pending_hit_refs"][..], &["pendingHitRefs"][..]],
                    )
                })
                .unwrap_or_default();
            if pending_hit_refs.is_empty() {
                pending_hit_refs = missing_inputs.clone();
            }
            for pending_hit_ref in &pending_hit_refs {
                limecore_policy_pending_hit_refs.insert(pending_hit_ref.to_string());
            }
            *limecore_policy_statuses.entry(status.clone()).or_insert(0) += 1;
            *limecore_policy_decisions
                .entry(decision.clone())
                .or_insert(0) += 1;
            limecore_policy_items.push(json!({
                "artifactPath": snapshot.get("artifactPath").cloned().unwrap_or(Value::Null),
                "contractKey": contract_key.clone(),
                "executionProfileKey": snapshot.get("executionProfileKey").cloned().unwrap_or(Value::Null),
                "executorAdapterKey": snapshot.get("executorAdapterKey").cloned().unwrap_or(Value::Null),
                "refs": snapshot_limecore_policy_refs,
                "status": status,
                "decision": decision,
                "decisionSource": decision_source,
                "decisionScope": decision_scope,
                "decisionReason": decision_reason,
                "policyEvaluation": policy_evaluation,
                "policyInputs": policy_inputs,
                "policyValueHits": policy_value_hits,
                "policyValueHitCount": policy_value_hit_count,
                "pendingHitRefs": pending_hit_refs,
                "unresolvedRefs": unresolved_refs,
                "missingInputs": missing_inputs,
                "source": limecore_policy_snapshot
                    .and_then(|value| value.get("source"))
                    .cloned()
                    .unwrap_or_else(|| Value::String("modality_runtime_contract".to_string())),
            }));
        }

        if source
            .as_deref()
            .map(is_runtime_contract_tool_trace_source)
            .unwrap_or(false)
        {
            trace_items.push(json!({
                "artifactPath": snapshot.get("artifactPath").cloned().unwrap_or(Value::Null),
                "source": source.clone(),
                "contractKey": contract_key.clone(),
                "routingEvent": snapshot.get("routingEvent").cloned().unwrap_or(Value::Null),
                "routingOutcome": snapshot.get("routingOutcome").cloned().unwrap_or(Value::Null),
                "expectedRoutingSlot": snapshot.get("expectedRoutingSlot").cloned().unwrap_or(Value::Null),
                "executionProfileKey": snapshot.get("executionProfileKey").cloned().unwrap_or(Value::Null),
                "executorAdapterKey": snapshot.get("executorAdapterKey").cloned().unwrap_or(Value::Null),
                "limecorePolicyRefs": snapshot.get("limecorePolicyRefs").cloned().unwrap_or(Value::Null),
                "entrySource": snapshot.get("entrySource").cloned().unwrap_or(Value::Null),
                "executorBindingKey": snapshot
                    .pointer("/runtimeContract/executor_binding/binding_key")
                    .cloned()
                    .unwrap_or(Value::Null),
            }));
        }

        if let Some(browser_action) = snapshot
            .get("browserAction")
            .filter(|value| value.is_object())
        {
            if let Some(status) = snapshot_string(browser_action, "status") {
                *browser_action_statuses.entry(status).or_insert(0) += 1;
            }
            if let Some(artifact_kind) = snapshot_string(browser_action, "artifactKind") {
                *browser_action_kinds.entry(artifact_kind).or_insert(0) += 1;
            }
            if let Some(action) = snapshot_string(browser_action, "action") {
                *browser_action_names.entry(action).or_insert(0) += 1;
            }
            if let Some(session_id) = snapshot_string(browser_action, "sessionId") {
                browser_session_ids.insert(session_id);
            }
            if let Some(target_id) = snapshot_string(browser_action, "targetId") {
                browser_target_ids.insert(target_id);
            }
            if let Some(profile_key) = snapshot_string(browser_action, "profileKey") {
                browser_profile_keys.insert(profile_key);
            }
            if let Some(backend) = snapshot_string(browser_action, "backend") {
                *browser_backends.entry(backend).or_insert(0) += 1;
            }
            if let Some(last_url) = snapshot_string(browser_action, "lastUrl") {
                browser_last_url = Some(last_url);
            }
            if read_json_bool(browser_action, &[&["observationAvailable"][..]]).unwrap_or(false) {
                browser_observation_count += 1;
            }
            if read_json_bool(browser_action, &[&["screenshotAvailable"][..]]).unwrap_or(false) {
                browser_screenshot_count += 1;
            }
            browser_action_items.push(json!({
                "artifactPath": snapshot.get("artifactPath").cloned().unwrap_or(Value::Null),
                "contractKey": contract_key.clone(),
                "source": source.clone(),
                "entrySource": snapshot.get("entrySource").cloned().unwrap_or(Value::Null),
                "artifactKind": browser_action.get("artifactKind").cloned().unwrap_or(Value::Null),
                "toolName": browser_action.get("toolName").cloned().unwrap_or(Value::Null),
                "action": browser_action.get("action").cloned().unwrap_or(Value::Null),
                "status": browser_action.get("status").cloned().unwrap_or(Value::Null),
                "success": browser_action.get("success").cloned().unwrap_or(Value::Null),
                "sessionId": browser_action.get("sessionId").cloned().unwrap_or(Value::Null),
                "targetId": browser_action.get("targetId").cloned().unwrap_or(Value::Null),
                "profileKey": browser_action.get("profileKey").cloned().unwrap_or(Value::Null),
                "backend": browser_action.get("backend").cloned().unwrap_or(Value::Null),
                "requestId": browser_action.get("requestId").cloned().unwrap_or(Value::Null),
                "lastUrl": browser_action.get("lastUrl").cloned().unwrap_or(Value::Null),
                "title": browser_action.get("title").cloned().unwrap_or(Value::Null),
                "attemptCount": browser_action.get("attemptCount").cloned().unwrap_or(Value::Null),
                "observationAvailable": browser_action.get("observationAvailable").cloned().unwrap_or(Value::Null),
                "screenshotAvailable": browser_action.get("screenshotAvailable").cloned().unwrap_or(Value::Null),
            }));
        }

        if let Some(audio_output) = snapshot
            .get("audioOutput")
            .filter(|value| value.is_object())
        {
            if let Some(status) = snapshot_string(audio_output, "status") {
                *audio_output_statuses.entry(status).or_insert(0) += 1;
            }
            if let Some(error_code) = snapshot_string(audio_output, "errorCode") {
                audio_output_error_codes.insert(error_code);
            }
            audio_output_items.push(json!({
                "artifactPath": snapshot.get("artifactPath").cloned().unwrap_or(Value::Null),
                "taskId": snapshot.get("taskId").cloned().unwrap_or(Value::Null),
                "status": audio_output.get("status").cloned().unwrap_or(Value::Null),
                "audioPath": audio_output.get("audioPath").cloned().unwrap_or(Value::Null),
                "mimeType": audio_output.get("mimeType").cloned().unwrap_or(Value::Null),
                "durationMs": audio_output.get("durationMs").cloned().unwrap_or(Value::Null),
                "providerId": audio_output.get("providerId").cloned().unwrap_or(Value::Null),
                "model": audio_output.get("model").cloned().unwrap_or(Value::Null),
                "errorCode": audio_output.get("errorCode").cloned().unwrap_or(Value::Null),
                "retryable": audio_output.get("retryable").cloned().unwrap_or(Value::Null),
                "workerId": audio_output.get("workerId").cloned().unwrap_or(Value::Null),
            }));
        }

        if let Some(transcript) = snapshot.get("transcript").filter(|value| value.is_object()) {
            if let Some(status) = snapshot_string(transcript, "status") {
                *transcript_statuses.entry(status).or_insert(0) += 1;
            }
            if let Some(error_code) = snapshot_string(transcript, "errorCode") {
                transcript_error_codes.insert(error_code);
            }
            transcript_items.push(json!({
                "artifactPath": snapshot.get("artifactPath").cloned().unwrap_or(Value::Null),
                "taskId": snapshot.get("taskId").cloned().unwrap_or(Value::Null),
                "status": transcript.get("status").cloned().unwrap_or(Value::Null),
                "transcriptPath": transcript.get("transcriptPath").cloned().unwrap_or(Value::Null),
                "sourceUrl": transcript.get("sourceUrl").cloned().unwrap_or(Value::Null),
                "sourcePath": transcript.get("sourcePath").cloned().unwrap_or(Value::Null),
                "language": transcript.get("language").cloned().unwrap_or(Value::Null),
                "outputFormat": transcript.get("outputFormat").cloned().unwrap_or(Value::Null),
                "providerId": transcript.get("providerId").cloned().unwrap_or(Value::Null),
                "model": transcript.get("model").cloned().unwrap_or(Value::Null),
                "errorCode": transcript.get("errorCode").cloned().unwrap_or(Value::Null),
                "retryable": transcript.get("retryable").cloned().unwrap_or(Value::Null),
                "workerId": transcript.get("workerId").cloned().unwrap_or(Value::Null),
            }));
        }
    }

    let limecore_policy_ref_keys = limecore_policy_refs.into_iter().collect::<Vec<_>>();

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
        "executionProfileKeys": execution_profile_keys.into_iter().collect::<Vec<_>>(),
        "executorAdapterKeys": executor_adapter_keys.into_iter().collect::<Vec<_>>(),
        "taskIndex": {
            "snapshotCount": task_index_items.len(),
            "threadIds": task_thread_ids.into_iter().collect::<Vec<_>>(),
            "turnIds": task_turn_ids.into_iter().collect::<Vec<_>>(),
            "contentIds": task_content_ids.into_iter().collect::<Vec<_>>(),
            "entryKeys": task_entry_keys.into_iter().collect::<Vec<_>>(),
            "modalities": task_modalities.into_iter().collect::<Vec<_>>(),
            "skillIds": task_skill_ids.into_iter().collect::<Vec<_>>(),
            "modelIds": task_model_ids.into_iter().collect::<Vec<_>>(),
            "executorKinds": task_executor_kinds.into_iter().collect::<Vec<_>>(),
            "executorBindingKeys": task_executor_binding_keys.into_iter().collect::<Vec<_>>(),
            "costStates": task_cost_states.into_iter().collect::<Vec<_>>(),
            "limitStates": task_limit_states.into_iter().collect::<Vec<_>>(),
            "estimatedCostClasses": task_estimated_cost_classes.into_iter().collect::<Vec<_>>(),
            "limitEventKinds": task_limit_event_kinds.into_iter().collect::<Vec<_>>(),
            "quotaLowCount": task_quota_low_count,
            "items": task_index_items,
        },
        "limecorePolicyRefs": limecore_policy_ref_keys.clone(),
        "limecorePolicyIndex": {
            "snapshotCount": limecore_policy_items.len(),
            "refKeys": limecore_policy_ref_keys,
            "missingInputs": limecore_policy_missing_inputs.into_iter().collect::<Vec<_>>(),
            "pendingHitRefs": limecore_policy_pending_hit_refs.into_iter().collect::<Vec<_>>(),
            "policyValueHitCount": limecore_policy_value_hit_count,
            "statusCounts": limecore_policy_statuses
                .into_iter()
                .map(|(status, count)| json!({ "status": status, "count": count }))
                .collect::<Vec<_>>(),
            "decisionCounts": limecore_policy_decisions
                .into_iter()
                .map(|(decision, count)| json!({ "decision": decision, "count": count }))
                .collect::<Vec<_>>(),
            "items": limecore_policy_items,
        },
        "toolTraceIndex": {
            "traceCount": trace_items.len(),
            "items": trace_items,
        },
        "audioOutputIndex": {
            "outputCount": audio_output_items.len(),
            "statusCounts": audio_output_statuses
                .into_iter()
                .map(|(status, count)| json!({ "status": status, "count": count }))
                .collect::<Vec<_>>(),
            "errorCodes": audio_output_error_codes.into_iter().collect::<Vec<_>>(),
            "items": audio_output_items,
        },
        "transcriptIndex": {
            "transcriptCount": transcript_items.len(),
            "statusCounts": transcript_statuses
                .into_iter()
                .map(|(status, count)| json!({ "status": status, "count": count }))
                .collect::<Vec<_>>(),
            "errorCodes": transcript_error_codes.into_iter().collect::<Vec<_>>(),
            "items": transcript_items,
        },
        "browserActionIndex": {
            "actionCount": browser_action_items.len(),
            "sessionCount": browser_session_ids.len(),
            "observationCount": browser_observation_count,
            "screenshotCount": browser_screenshot_count,
            "lastUrl": browser_last_url,
            "sessionIds": browser_session_ids.into_iter().collect::<Vec<_>>(),
            "targetIds": browser_target_ids.into_iter().collect::<Vec<_>>(),
            "profileKeys": browser_profile_keys.into_iter().collect::<Vec<_>>(),
            "statusCounts": browser_action_statuses
                .into_iter()
                .map(|(status, count)| json!({ "status": status, "count": count }))
                .collect::<Vec<_>>(),
            "artifactKindCounts": browser_action_kinds
                .into_iter()
                .map(|(artifact_kind, count)| json!({ "artifactKind": artifact_kind, "count": count }))
                .collect::<Vec<_>>(),
            "actionCounts": browser_action_names
                .into_iter()
                .map(|(action, count)| json!({ "action": action, "count": count }))
                .collect::<Vec<_>>(),
            "backendCounts": browser_backends
                .into_iter()
                .map(|(backend, count)| json!({ "backend": backend, "count": count }))
                .collect::<Vec<_>>(),
            "items": browser_action_items,
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
        || source.contains("transcription_task")
}

fn extract_audio_output_snapshot(document: &Value) -> Option<Value> {
    let audio_output = find_json_value_at_paths(
        document,
        &[
            &["audio_output"][..],
            &["audioOutput"][..],
            &["payload", "audio_output"][..],
            &["payload", "audioOutput"][..],
            &["result", "audio_output"][..],
            &["result", "audioOutput"][..],
            &["record", "payload", "audio_output"][..],
            &["record", "payload", "audioOutput"][..],
            &["record", "result", "audio_output"][..],
            &["record", "result", "audioOutput"][..],
        ],
    )
    .filter(|value| value.is_object())?;

    Some(json!({
        "kind": read_json_string(audio_output, &[&["kind"][..]]).unwrap_or_else(|| "audio_output".to_string()),
        "status": read_json_string(audio_output, &[&["status"][..]]),
        "audioPath": read_json_string(audio_output, &[&["audio_path"][..], &["audioPath"][..]]),
        "mimeType": read_json_string(audio_output, &[&["mime_type"][..], &["mimeType"][..]]),
        "durationMs": find_json_value_at_paths(audio_output, &[&["duration_ms"][..], &["durationMs"][..]])
            .cloned()
            .unwrap_or(Value::Null),
        "sourceText": read_json_string(audio_output, &[&["source_text"][..], &["sourceText"][..]]),
        "voice": read_json_string(audio_output, &[&["voice"][..]]),
        "providerId": read_json_string(audio_output, &[&["provider_id"][..], &["providerId"][..]]),
        "model": read_json_string(audio_output, &[&["model"][..]]),
        "errorCode": read_json_string(audio_output, &[&["error_code"][..], &["errorCode"][..]]),
        "errorMessage": read_json_string(audio_output, &[&["error_message"][..], &["errorMessage"][..]]),
        "retryable": find_json_value_at_paths(audio_output, &[&["retryable"][..]])
            .cloned()
            .unwrap_or(Value::Null),
        "stage": read_json_string(audio_output, &[&["stage"][..]]),
        "workerId": read_json_string(
            document,
            &[
                &["current_attempt_worker_id"][..],
                &["currentAttemptWorkerId"][..],
                &["record", "current_attempt_worker_id"][..],
                &["record", "currentAttemptWorkerId"][..],
            ],
        ),
    }))
}

fn extract_transcript_snapshot(document: &Value) -> Option<Value> {
    let transcript = find_json_value_at_paths(
        document,
        &[
            &["transcript"][..],
            &["payload", "transcript"][..],
            &["result", "transcript"][..],
            &["record", "payload", "transcript"][..],
            &["record", "result", "transcript"][..],
        ],
    )
    .filter(|value| value.is_object())?;

    Some(json!({
        "kind": read_json_string(transcript, &[&["kind"][..]]).unwrap_or_else(|| "transcript".to_string()),
        "status": read_json_string(transcript, &[&["status"][..]]),
        "transcriptPath": read_json_string(transcript, &[&["transcript_path"][..], &["transcriptPath"][..], &["path"][..]]),
        "sourceUrl": read_json_string(transcript, &[&["source_url"][..], &["sourceUrl"][..]]),
        "sourcePath": read_json_string(transcript, &[&["source_path"][..], &["sourcePath"][..]]),
        "language": read_json_string(transcript, &[&["language"][..]]),
        "outputFormat": read_json_string(transcript, &[&["output_format"][..], &["outputFormat"][..]]),
        "timestamps": find_json_value_at_paths(transcript, &[&["timestamps"][..]])
            .cloned()
            .unwrap_or(Value::Null),
        "speakerLabels": find_json_value_at_paths(transcript, &[&["speaker_labels"][..], &["speakerLabels"][..]])
            .cloned()
            .unwrap_or(Value::Null),
        "providerId": read_json_string(transcript, &[&["provider_id"][..], &["providerId"][..]]),
        "model": read_json_string(transcript, &[&["model"][..]]),
        "errorCode": read_json_string(transcript, &[&["error_code"][..], &["errorCode"][..]]),
        "errorMessage": read_json_string(transcript, &[&["error_message"][..], &["errorMessage"][..]]),
        "retryable": find_json_value_at_paths(transcript, &[&["retryable"][..]])
            .cloned()
            .unwrap_or(Value::Null),
        "stage": read_json_string(transcript, &[&["stage"][..]]),
        "workerId": read_json_string(
            document,
            &[
                &["current_attempt_worker_id"][..],
                &["currentAttemptWorkerId"][..],
                &["record", "current_attempt_worker_id"][..],
                &["record", "currentAttemptWorkerId"][..],
            ],
        ),
    }))
}

fn build_known_gaps(
    recent_artifacts: &[RuntimeRecentArtifact],
    signal_coverage: &[RuntimeEvidenceSignalCoverageEntry],
    thread_read: &AgentRuntimeThreadReadModel,
) -> Vec<String> {
    let mut gaps = signal_coverage
        .iter()
        .filter(|entry| entry.status != "exported")
        .map(|entry| entry.detail.clone())
        .collect::<Vec<_>>();

    if let Some(gap) = permission_confirmation_known_gap(thread_read) {
        gaps.push(gap);
    }
    if let Some(gap) = user_locked_capability_known_gap(thread_read) {
        gaps.push(gap);
    }

    if recent_artifacts.is_empty() {
        gaps.push("当前未检测到最近产物路径，Artifact 证据为空。".to_string());
    }

    gaps.dedup();
    gaps
}

fn user_locked_capability_known_gap(thread_read: &AgentRuntimeThreadReadModel) -> Option<String> {
    let limit_state = thread_read.limit_state.as_ref()?;
    if limit_state.status != "user_locked_capability_gap" {
        return None;
    }
    let capability_gap = limit_state
        .capability_gap
        .as_deref()
        .or(thread_read.capability_gap.as_deref())
        .unwrap_or("未记录 capabilityGap");
    Some(format!(
        "显式用户模型锁定不满足当前 execution profile，当前证据包不能作为成功交付证据：capabilityGap={}。",
        capability_gap
    ))
}

fn permission_confirmation_known_gap(thread_read: &AgentRuntimeThreadReadModel) -> Option<String> {
    let permission_state = thread_read.permission_state.as_ref()?;
    if permission_state.confirmation_status.as_deref() != Some("denied") {
        return unresolved_permission_confirmation_blocking_detail(permission_state);
    }

    Some(format!(
        "运行时权限确认已被拒绝，当前证据包不能作为成功交付证据：request_id={}，source={}。",
        permission_state
            .confirmation_request_id
            .as_deref()
            .unwrap_or("未记录 confirmationRequestId"),
        permission_state
            .confirmation_source
            .as_deref()
            .unwrap_or("未记录 confirmationSource")
    ))
}

fn unresolved_permission_confirmation_blocking_detail(
    permission_state: &lime_agent::SessionExecutionRuntimePermissionState,
) -> Option<String> {
    let confirmation_status = permission_state.confirmation_status.as_deref();
    if permission_state.status != "requires_confirmation"
        || matches!(confirmation_status, Some("resolved" | "denied"))
    {
        return None;
    }

    let ask_profile_keys =
        format_permission_profile_keys(&permission_state.ask_profile_keys, "未记录 askProfileKeys");
    let confirmation_source = permission_state
        .confirmation_source
        .as_deref()
        .unwrap_or("未记录 confirmationSource");
    let confirmation_request_id = permission_state
        .confirmation_request_id
        .as_deref()
        .unwrap_or("未记录 confirmationRequestId");

    Some(match confirmation_status {
        Some("not_requested") => format!(
            "声明态权限需要真实确认但尚未发起 ApprovalRequest，当前证据包不能作为成功交付证据：askProfileKeys={}，source={}。",
            ask_profile_keys, confirmation_source
        ),
        Some("requested") => format!(
            "真实权限确认正在等待处理，当前证据包不能作为成功交付证据：askProfileKeys={}，request_id={}，source={}。",
            ask_profile_keys, confirmation_request_id, confirmation_source
        ),
        Some(other) => format!(
            "运行时权限确认状态尚未解决，当前证据包不能作为成功交付证据：confirmationStatus={}，askProfileKeys={}，source={}。",
            other, ask_profile_keys, confirmation_source
        ),
        None => format!(
            "运行时权限声明仍需确认但缺少 confirmationStatus，当前证据包不能作为成功交付证据：askProfileKeys={}，source={}。",
            ask_profile_keys, confirmation_source
        ),
    })
}

fn format_permission_profile_keys(values: &[String], fallback: &str) -> String {
    if values.is_empty() {
        fallback.to_string()
    } else {
        values.join(", ")
    }
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

fn collect_capability_draft_controlled_get_evidence(
    workspace_root: &Path,
    session_id: &str,
) -> RuntimeCapabilityDraftControlledGetEvidenceSummary {
    let evidence_dir = workspace_root
        .join(CAPABILITY_DRAFTS_RELATIVE_ROOT.replace('/', std::path::MAIN_SEPARATOR_STR))
        .join(CONTROLLED_GET_EVIDENCE_DIR_NAME);
    let mut summary = RuntimeCapabilityDraftControlledGetEvidenceSummary::default();
    let Ok(entries) = fs::read_dir(evidence_dir.as_path()) else {
        return summary;
    };

    let mut artifacts = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

        let Ok(raw) = fs::read_to_string(path.as_path()) else {
            continue;
        };
        let Ok(document) = serde_json::from_str::<Value>(raw.as_str()) else {
            continue;
        };
        if document.get("artifactKind").and_then(Value::as_str)
            != Some(CONTROLLED_GET_EVIDENCE_ARTIFACT_KIND)
        {
            continue;
        }
        if document.get("sessionId").and_then(Value::as_str) != Some(session_id) {
            continue;
        }

        summary.scanned_artifact_count += 1;
        if !is_safe_controlled_get_evidence_artifact(&document) {
            summary.skipped_unsafe_artifact_count += 1;
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("unknown.json");
        let relative_path = format!(
            "{CAPABILITY_DRAFTS_RELATIVE_ROOT}/{CONTROLLED_GET_EVIDENCE_DIR_NAME}/{file_name}"
        );
        let sort_key = document
            .get("executedAt")
            .and_then(Value::as_str)
            .unwrap_or(file_name)
            .to_string();
        artifacts.push((
            sort_key,
            build_controlled_get_evidence_artifact_summary(
                &document,
                relative_path,
                raw.as_bytes(),
            ),
        ));
    }

    artifacts.sort_by(|left, right| right.0.cmp(&left.0));
    summary.artifacts = artifacts
        .into_iter()
        .map(|(_, artifact)| artifact)
        .take(MAX_CONTROLLED_GET_EVIDENCE_ARTIFACTS)
        .collect();
    summary
}

fn is_safe_controlled_get_evidence_artifact(document: &Value) -> bool {
    document.get("valueRetention").and_then(Value::as_str) == Some("hash_and_metadata_only")
        && document
            .get("containsEndpointValue")
            .and_then(Value::as_bool)
            == Some(false)
        && document.get("containsTokenValue").and_then(Value::as_bool) == Some(false)
        && document
            .get("containsResponsePreview")
            .and_then(Value::as_bool)
            == Some(false)
        && document
            .get("endpointValueReturned")
            .and_then(Value::as_bool)
            == Some(false)
        && document
            .get("endpointInputPersisted")
            .and_then(Value::as_bool)
            == Some(false)
        && document.get("tokenPersisted").and_then(Value::as_bool) == Some(false)
}

fn build_controlled_get_evidence_artifact_summary(
    document: &Value,
    relative_path: String,
    raw: &[u8],
) -> Value {
    json!({
        "artifactId": document.get("artifactId").and_then(Value::as_str),
        "artifactKind": CONTROLLED_GET_EVIDENCE_ARTIFACT_KIND,
        "relativePath": relative_path,
        "contentSha256": sha256_bytes_hex(raw),
        "approvalId": document.get("approvalId").and_then(Value::as_str),
        "sessionId": document.get("sessionId").and_then(Value::as_str),
        "status": document.get("status").and_then(Value::as_str),
        "scope": document.get("scope").and_then(Value::as_str),
        "gateId": document.get("gateId").and_then(Value::as_str),
        "method": document.get("method").and_then(Value::as_str),
        "requestUrlHash": document.get("requestUrlHash").and_then(Value::as_str),
        "requestUrlHashAlgorithm": document
            .get("requestUrlHashAlgorithm")
            .and_then(Value::as_str),
        "responseStatus": document.get("responseStatus").cloned().unwrap_or(Value::Null),
        "responseSha256": document.get("responseSha256").and_then(Value::as_str),
        "responseBytes": document.get("responseBytes").cloned().unwrap_or(Value::Null),
        "responsePreviewTruncated": document
            .get("responsePreviewTruncated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        "executedAt": document.get("executedAt").and_then(Value::as_str),
        "networkRequestSent": document
            .get("networkRequestSent")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        "responseCaptured": document
            .get("responseCaptured")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        "credentialReferenceId": document
            .get("credentialReferenceId")
            .and_then(Value::as_str),
        "valueRetention": "hash_and_metadata_only",
        "safety": {
            "containsEndpointValue": false,
            "containsTokenValue": false,
            "containsResponsePreview": false,
            "endpointValueReturned": false,
            "endpointInputPersisted": false,
            "tokenPersisted": false,
            "runtimeExecutionEnabled": false
        },
        "evidenceKeys": collect_controlled_get_evidence_keys(document),
    })
}

fn collect_controlled_get_evidence_keys(document: &Value) -> Vec<String> {
    document
        .get("evidence")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("key").and_then(Value::as_str))
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn build_capability_draft_controlled_get_evidence_json(
    summary: &RuntimeCapabilityDraftControlledGetEvidenceSummary,
) -> Value {
    json!({
        "source": CONTROLLED_GET_EVIDENCE_ARTIFACT_KIND,
        "artifactRoot": format!(
            "{CAPABILITY_DRAFTS_RELATIVE_ROOT}/{CONTROLLED_GET_EVIDENCE_DIR_NAME}"
        ),
        "valueRetention": "hash_and_metadata_only",
        "scannedArtifactCount": summary.scanned_artifact_count,
        "artifactCount": summary.artifacts.len(),
        "skippedUnsafeArtifactCount": summary.skipped_unsafe_artifact_count,
        "statusCounts": build_controlled_get_evidence_status_counts(summary),
        "artifacts": summary.artifacts.clone(),
        "notes": [
            "该摘要只消费当前 session 的受控 GET evidence artifact。",
            "摘要只保留 hash / status / response metadata / evidence keys，不复制 endpoint、token 或 response preview。"
        ]
    })
}

fn sha256_bytes_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
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
        "permissionState": thread_read.permission_state,
        "oemPolicy": thread_read.oem_policy,
        "auxiliaryTaskRuntime": thread_read.auxiliary_task_runtime
    })
}

fn permission_state_signal_coverage(
    thread_read: &AgentRuntimeThreadReadModel,
) -> RuntimeEvidenceSignalCoverageEntry {
    let Some(permission_state) = thread_read.permission_state.as_ref() else {
        return RuntimeEvidenceSignalCoverageEntry {
            signal: "permissionState",
            status: "missing",
            source: "thread_read.permission_state",
            detail: "thread_read 缺少 permission_state。".to_string(),
        };
    };

    let confirmation_status = permission_state.confirmation_status.as_deref();
    let confirmation_request_id = permission_state
        .confirmation_request_id
        .as_deref()
        .unwrap_or("未记录 confirmationRequestId");
    let confirmation_source = permission_state
        .confirmation_source
        .as_deref()
        .unwrap_or("未记录 confirmationSource");

    if confirmation_status == Some("denied") {
        return RuntimeEvidenceSignalCoverageEntry {
            signal: "permissionState",
            status: "blocked",
            source: "thread_read.permission_state",
            detail: format!(
                "thread_read 已导出 permission_state，但真实权限确认已被拒绝：request_id={confirmation_request_id}, source={confirmation_source}。"
            ),
        };
    }

    if let Some(detail) = unresolved_permission_confirmation_blocking_detail(permission_state) {
        return RuntimeEvidenceSignalCoverageEntry {
            signal: "permissionState",
            status: "blocked",
            source: "thread_read.permission_state",
            detail: format!("thread_read 已导出 permission_state，但{detail}"),
        };
    }

    let detail = match confirmation_status {
        Some("resolved") => format!(
            "thread_read 已导出 permission_state，真实权限确认已通过：request_id={confirmation_request_id}, source={confirmation_source}。"
        ),
        Some("requested") => format!(
            "thread_read 已导出 permission_state，真实权限确认正在等待处理：request_id={confirmation_request_id}, source={confirmation_source}。"
        ),
        Some("not_requested") => {
            "thread_read 已导出 permission_state，声明态权限尚未发起真实审批请求。".to_string()
        }
        Some(other) => format!(
            "thread_read 已导出 permission_state，confirmationStatus={other}, source={confirmation_source}。"
        ),
        None => "thread_read 已导出 permission_state。".to_string(),
    };

    RuntimeEvidenceSignalCoverageEntry {
        signal: "permissionState",
        status: "exported",
        source: "thread_read.permission_state",
        detail,
    }
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
        permission_state_signal_coverage(thread_read),
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
        "modalityRuntimeContracts": build_modality_runtime_contracts_observability_summary_json(modality_runtime_contracts),
        "latest": {
            "warning": latest_warning_json(diagnostics),
            "failedTool": latest_failed_tool_json(diagnostics),
            "failedCommand": latest_failed_command_json(diagnostics)
        },
        "runtimeFacts": build_thread_runtime_facts_json(thread_read),
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
            extract_browser_control_contract_snapshot(
                item.id.as_str(),
                tool_name.as_str(),
                arguments.as_ref(),
                *success,
                metadata.as_ref(),
                artifact_path.as_str(),
            )
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
        let Some(mut snapshot) = snapshot else {
            continue;
        };
        enrich_modality_runtime_contract_snapshot_with_thread_item(&mut snapshot, item);
        summary.applicable_count += 1;
        summary.snapshots.push(snapshot);
        if summary.snapshots.len() >= MAX_RECENT_ARTIFACTS {
            break;
        }
    }

    summary
}

fn enrich_modality_runtime_contract_snapshot_with_thread_item(
    snapshot: &mut Value,
    item: &AgentThreadItem,
) {
    let Some(object) = snapshot.as_object_mut() else {
        return;
    };

    if object.get("threadId").map_or(true, Value::is_null) {
        object.insert(
            "threadId".to_string(),
            Value::String(item.thread_id.clone()),
        );
    }
    if object.get("turnId").map_or(true, Value::is_null) {
        object.insert("turnId".to_string(), Value::String(item.turn_id.clone()));
    }
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
        || normalized_path.contains(".lime/tasks/transcription_generate/")
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
                        || value.eq_ignore_ascii_case("transcription_generate")
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

fn extract_browser_control_contract_snapshot(
    item_id: &str,
    tool_name: &str,
    arguments: Option<&Value>,
    success: Option<bool>,
    metadata: Option<&Value>,
    artifact_path: &str,
) -> Option<Value> {
    let metadata = metadata?;
    let mut snapshot = extract_modality_runtime_contract_snapshot(metadata, artifact_path)?;
    if snapshot.get("contractKey").and_then(Value::as_str) != Some(BROWSER_CONTROL_CONTRACT_KEY) {
        return Some(snapshot);
    }

    if let Value::Object(object) = &mut snapshot {
        object.insert(
            "browserAction".to_string(),
            build_browser_action_contract_index_item(
                item_id, tool_name, arguments, success, metadata,
            ),
        );
    }

    Some(snapshot)
}

fn build_browser_action_contract_index_item(
    item_id: &str,
    tool_name: &str,
    arguments: Option<&Value>,
    success: Option<bool>,
    metadata: &Value,
) -> Value {
    let action = read_json_string(metadata, &[&["action"][..], &["result", "action"][..]])
        .unwrap_or_else(|| infer_browser_action_name(tool_name));
    let artifact_kind = infer_browser_action_artifact_kind(action.as_str());
    let action_success =
        read_json_bool(metadata, &[&["result", "success"][..], &["success"][..]]).or(success);
    let status = match action_success {
        Some(true) => "completed",
        Some(false) => "failed",
        None => "unknown",
    };
    let attempt_count = read_json_usize(metadata, &[&["attempt_count"][..], &["attemptCount"][..]])
        .or_else(|| {
            metadata
                .get("attempts")
                .and_then(Value::as_array)
                .map(Vec::len)
        })
        .or_else(|| {
            metadata
                .pointer("/result/attempts")
                .and_then(Value::as_array)
                .map(Vec::len)
        });
    let last_url = read_json_string(
        metadata,
        &[
            &["browser_session", "target_url"][..],
            &["browserSession", "targetUrl"][..],
            &["result", "data", "browser_session", "target_url"][..],
            &["result", "data", "browserSession", "targetUrl"][..],
            &["result", "data", "target_url"][..],
            &["result", "data", "targetUrl"][..],
            &["result", "data", "url"][..],
            &["result", "data", "tab", "url"][..],
            &["result", "target_url"][..],
            &["result", "targetUrl"][..],
            &["result", "url"][..],
        ],
    )
    .or_else(|| {
        arguments.and_then(|arguments| {
            read_json_string(
                arguments,
                &[
                    &["url"][..],
                    &["target_url"][..],
                    &["targetUrl"][..],
                    &["page_url"][..],
                    &["pageUrl"][..],
                ],
            )
        })
    });
    let screenshot_available = has_browser_screenshot(metadata);
    let observation_available =
        artifact_kind == "browser_snapshot" || screenshot_available || last_url.is_some();

    json!({
        "itemId": item_id,
        "artifactKind": artifact_kind,
        "toolName": tool_name,
        "action": action,
        "status": status,
        "success": action_success,
        "sessionId": read_json_string(
            metadata,
            &[
                &["browser_session", "session_id"][..],
                &["browserSession", "sessionId"][..],
                &["result", "session_id"][..],
                &["result", "sessionId"][..],
                &["result", "data", "session_id"][..],
                &["result", "data", "sessionId"][..],
                &["result", "data", "browser_session", "session_id"][..],
                &["result", "data", "browserSession", "sessionId"][..],
            ],
        ),
        "targetId": read_json_string(
            metadata,
            &[
                &["browser_session", "target_id"][..],
                &["browserSession", "targetId"][..],
                &["result", "target_id"][..],
                &["result", "targetId"][..],
                &["result", "data", "target_id"][..],
                &["result", "data", "targetId"][..],
                &["result", "data", "browser_session", "target_id"][..],
                &["result", "data", "browserSession", "targetId"][..],
                &["result", "data", "tab", "id"][..],
            ],
        ),
        "profileKey": read_json_string(
            metadata,
            &[
                &["browser_session", "profile_key"][..],
                &["browserSession", "profileKey"][..],
                &["result", "data", "profile_key"][..],
                &["result", "data", "profileKey"][..],
                &["result", "data", "browser_session", "profile_key"][..],
                &["result", "data", "browserSession", "profileKey"][..],
            ],
        ),
        "backend": read_json_string(
            metadata,
            &[&["selected_backend"][..], &["selectedBackend"][..], &["result", "backend"][..]],
        ),
        "requestId": read_json_string(
            metadata,
            &[&["result", "request_id"][..], &["result", "requestId"][..]],
        ),
        "lastUrl": last_url,
        "title": read_json_string(
            metadata,
            &[
                &["browser_session", "target_title"][..],
                &["browserSession", "targetTitle"][..],
                &["result", "data", "title"][..],
                &["result", "data", "target_title"][..],
                &["result", "data", "targetTitle"][..],
                &["result", "data", "browser_session", "target_title"][..],
                &["result", "data", "browserSession", "targetTitle"][..],
            ],
        ),
        "attemptCount": attempt_count,
        "observationAvailable": observation_available,
        "screenshotAvailable": screenshot_available,
    })
}

fn infer_browser_action_name(tool_name: &str) -> String {
    tool_name
        .rsplit("__")
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(tool_name)
        .to_string()
}

fn infer_browser_action_artifact_kind(action: &str) -> &'static str {
    let normalized = action.trim().to_ascii_lowercase();
    if normalized.contains("snapshot")
        || normalized.contains("read_page")
        || normalized.contains("get_page")
        || normalized.contains("page_info")
        || normalized.contains("page_text")
        || normalized.contains("console")
        || normalized.contains("network")
        || normalized.contains("find")
        || normalized.contains("tabs_context")
    {
        "browser_snapshot"
    } else {
        "browser_session"
    }
}

fn has_browser_screenshot(metadata: &Value) -> bool {
    find_json_value_at_paths(
        metadata,
        &[
            &["screenshot"][..],
            &["screenshot_path"][..],
            &["screenshotPath"][..],
            &["result", "data", "screenshot"][..],
            &["result", "data", "screenshot_path"][..],
            &["result", "data", "screenshotPath"][..],
        ],
    )
    .map(json_value_has_content)
    .unwrap_or(false)
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
    let is_runtime_preflight_failure = failure_code
        .as_deref()
        .map(is_modality_runtime_preflight_failure_code)
        .unwrap_or(false);
    let is_image_generation_contract = contract_key == IMAGE_GENERATION_CONTRACT_KEY;
    let is_browser_control_contract = contract_key == BROWSER_CONTROL_CONTRACT_KEY;
    let is_pdf_extract_contract = contract_key == PDF_EXTRACT_CONTRACT_KEY;
    let is_voice_generation_contract = contract_key == VOICE_GENERATION_CONTRACT_KEY;
    let is_audio_transcription_contract = contract_key == AUDIO_TRANSCRIPTION_CONTRACT_KEY;
    let is_web_research_contract = contract_key == WEB_RESEARCH_CONTRACT_KEY;
    let is_text_transform_contract = contract_key == TEXT_TRANSFORM_CONTRACT_KEY;
    let is_audio_task_artifact = is_voice_generation_contract
        && (task_type.as_deref() == Some("audio_generate")
            || artifact_path
                .replace('\\', "/")
                .to_ascii_lowercase()
                .contains(".lime/tasks/audio_generate/"));
    let is_transcription_task_artifact = is_audio_transcription_contract
        && (task_type.as_deref() == Some("transcription_generate")
            || artifact_path
                .replace('\\', "/")
                .to_ascii_lowercase()
                .contains(".lime/tasks/transcription_generate/"));
    let routing_event = if is_contract_routing_failure {
        "routing_not_possible"
    } else if is_runtime_preflight_failure {
        "runtime_preflight"
    } else if is_browser_control_contract {
        "browser_action_requested"
    } else if is_pdf_extract_contract
        || is_voice_generation_contract
        || is_audio_transcription_contract
        || is_web_research_contract
        || is_text_transform_contract
    {
        "executor_invoked"
    } else {
        "model_routing_decision"
    };
    let routing_outcome = if is_contract_routing_failure || is_runtime_preflight_failure {
        "blocked"
    } else if normalized_status.as_deref() == Some("failed") {
        "failed"
    } else {
        "accepted"
    };
    let limecore_policy_refs =
        extract_runtime_contract_limecore_policy_refs(document, contract_key.as_str());
    let limecore_policy_snapshot =
        extract_runtime_contract_limecore_policy_snapshot(document, &limecore_policy_refs);
    let entry_source = read_modality_contract_entry_source(document);
    let entry_key = read_modality_contract_entry_key(document).or_else(|| entry_source.clone());
    let modality = read_json_string(
        document,
        &[
            &["modality"][..],
            &["payload", "modality"][..],
            &["record", "payload", "modality"][..],
            &["runtime_contract", "modality"][..],
            &["runtimeContract", "modality"][..],
            &["payload", "runtime_contract", "modality"][..],
            &["payload", "runtimeContract", "modality"][..],
            &["record", "payload", "runtime_contract", "modality"][..],
            &["record", "payload", "runtimeContract", "modality"][..],
        ],
    );
    let model = read_modality_contract_model(document);
    let model_id = read_modality_contract_model_id(document).or_else(|| model.clone());
    let executor_kind = extract_runtime_contract_executor_kind(document);
    let executor_binding_key = extract_runtime_contract_executor_binding_key(document);
    let skill_id =
        read_modality_contract_skill_id(document).or_else(|| match executor_kind.as_deref() {
            Some("skill") | Some("service_skill") => executor_binding_key.clone(),
            _ => None,
        });
    let cost_state = read_modality_contract_cost_state(document);
    let estimated_cost_class = read_modality_contract_estimated_cost_class(document);
    let limit_state = read_modality_contract_limit_state(document);
    let limit_event_kind = read_modality_contract_limit_event_kind(document);
    let quota_low = read_modality_contract_quota_low(document, limit_event_kind.as_deref());

    Some(json!({
        "artifactPath": artifact_path,
        "source": if is_browser_control_contract {
            "browser_action_trace.modality_runtime_contract"
        } else if is_pdf_extract_contract {
            "pdf_read_skill_trace.modality_runtime_contract"
        } else if is_audio_task_artifact {
            "audio_task.modality_runtime_contract"
        } else if is_transcription_task_artifact {
            "transcription_task.modality_runtime_contract"
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
        "threadId": read_modality_contract_thread_id(document),
        "turnId": read_modality_contract_turn_id(document),
        "contentId": read_modality_contract_content_id(document),
        "status": read_json_string(
            document,
            &[
                &["status"][..],
                &["record", "status"][..],
            ],
        ),
        "normalizedStatus": normalized_status,
        "contractKey": contract_key,
        "contractMatchedExpected": is_image_generation_contract || is_browser_control_contract || is_pdf_extract_contract || is_voice_generation_contract || is_audio_transcription_contract || is_web_research_contract || is_text_transform_contract,
        "expectedRoutingSlot": if is_image_generation_contract {
            Some(IMAGE_GENERATION_ROUTING_SLOT)
        } else if is_browser_control_contract {
            Some(BROWSER_CONTROL_ROUTING_SLOT)
        } else if is_pdf_extract_contract {
            Some(PDF_EXTRACT_ROUTING_SLOT)
        } else if is_voice_generation_contract {
            Some(VOICE_GENERATION_ROUTING_SLOT)
        } else if is_audio_transcription_contract {
            Some(AUDIO_TRANSCRIPTION_ROUTING_SLOT)
        } else if is_web_research_contract {
            Some(WEB_RESEARCH_ROUTING_SLOT)
        } else if is_text_transform_contract {
            Some(TEXT_TRANSFORM_ROUTING_SLOT)
        } else {
            None
        },
        "entryKey": entry_key,
        "entrySource": entry_source,
        "modality": modality,
        "skillId": skill_id,
        "modelId": model_id,
        "executorKind": executor_kind,
        "executorBindingKey": executor_binding_key,
        "costState": cost_state,
        "limitState": limit_state,
        "estimatedCostClass": estimated_cost_class,
        "limitEventKind": limit_event_kind,
        "quotaLow": quota_low,
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
        "executionProfileKey": extract_runtime_contract_execution_profile_key(document),
        "executorAdapterKey": extract_runtime_contract_executor_adapter_key(document),
        "limecorePolicyRefs": limecore_policy_refs,
        "limecorePolicySnapshot": limecore_policy_snapshot,
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
        "model": model,
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
        "audioOutput": if is_audio_task_artifact {
            extract_audio_output_snapshot(document)
        } else {
            None
        },
        "transcript": if is_transcription_task_artifact {
            extract_transcript_snapshot(document)
        } else {
            None
        },
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

fn read_modality_contract_thread_id(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["thread_id"][..],
            &["threadId"][..],
            &["payload", "thread_id"][..],
            &["payload", "threadId"][..],
            &["record", "payload", "thread_id"][..],
            &["record", "payload", "threadId"][..],
            &["runtime_summary", "thread_id"][..],
            &["runtimeSummary", "threadId"][..],
            &["request_metadata", "harness", "thread_id"][..],
            &["requestMetadata", "harness", "threadId"][..],
        ],
    )
}

fn read_modality_contract_turn_id(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["turn_id"][..],
            &["turnId"][..],
            &["payload", "turn_id"][..],
            &["payload", "turnId"][..],
            &["record", "payload", "turn_id"][..],
            &["record", "payload", "turnId"][..],
            &["runtime_summary", "turn_id"][..],
            &["runtimeSummary", "turnId"][..],
            &["request_metadata", "harness", "turn_id"][..],
            &["requestMetadata", "harness", "turnId"][..],
        ],
    )
}

fn read_modality_contract_content_id(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["content_id"][..],
            &["contentId"][..],
            &["payload", "content_id"][..],
            &["payload", "contentId"][..],
            &["record", "payload", "content_id"][..],
            &["record", "payload", "contentId"][..],
            &["runtime_summary", "content_id"][..],
            &["runtimeSummary", "contentId"][..],
            &["request_metadata", "harness", "content_id"][..],
            &["requestMetadata", "harness", "contentId"][..],
        ],
    )
}

fn read_modality_contract_entry_source(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["entry_source"][..],
            &["entrySource"][..],
            &["payload", "entry_source"][..],
            &["payload", "entrySource"][..],
            &["record", "payload", "entry_source"][..],
            &["record", "payload", "entrySource"][..],
            &["request_metadata", "harness", "entry_source"][..],
            &["requestMetadata", "harness", "entrySource"][..],
        ],
    )
}

fn read_modality_contract_entry_key(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["entry_key"][..],
            &["entryKey"][..],
            &["payload", "entry_key"][..],
            &["payload", "entryKey"][..],
            &["record", "payload", "entry_key"][..],
            &["record", "payload", "entryKey"][..],
            &["request_metadata", "harness", "entry_key"][..],
            &["requestMetadata", "harness", "entryKey"][..],
        ],
    )
}

fn read_modality_contract_skill_id(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["skill_id"][..],
            &["skillId"][..],
            &["service_skill_id"][..],
            &["serviceSkillId"][..],
            &["payload", "skill_id"][..],
            &["payload", "skillId"][..],
            &["payload", "service_skill_id"][..],
            &["payload", "serviceSkillId"][..],
            &["record", "payload", "skill_id"][..],
            &["record", "payload", "skillId"][..],
            &["record", "payload", "service_skill_id"][..],
            &["record", "payload", "serviceSkillId"][..],
        ],
    )
}

fn read_modality_contract_model(document: &Value) -> Option<String> {
    read_json_string(
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
    )
}

fn read_modality_contract_model_id(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["model_id"][..],
            &["modelId"][..],
            &["payload", "model_id"][..],
            &["payload", "modelId"][..],
            &["record", "payload", "model_id"][..],
            &["record", "payload", "modelId"][..],
        ],
    )
}

fn extract_runtime_contract_executor_kind(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["executor_kind"][..],
            &["executorKind"][..],
            &["payload", "executor_kind"][..],
            &["payload", "executorKind"][..],
            &["record", "payload", "executor_kind"][..],
            &["record", "payload", "executorKind"][..],
            &["runtime_contract", "executor_binding", "executor_kind"][..],
            &["runtimeContract", "executorBinding", "executorKind"][..],
            &[
                "payload",
                "runtime_contract",
                "executor_binding",
                "executor_kind",
            ][..],
            &[
                "payload",
                "runtimeContract",
                "executorBinding",
                "executorKind",
            ][..],
            &[
                "record",
                "payload",
                "runtime_contract",
                "executor_binding",
                "executor_kind",
            ][..],
            &[
                "record",
                "payload",
                "runtimeContract",
                "executorBinding",
                "executorKind",
            ][..],
        ],
    )
}

fn extract_runtime_contract_executor_binding_key(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["executor_binding_key"][..],
            &["executorBindingKey"][..],
            &["payload", "executor_binding_key"][..],
            &["payload", "executorBindingKey"][..],
            &["record", "payload", "executor_binding_key"][..],
            &["record", "payload", "executorBindingKey"][..],
            &["runtime_contract", "executor_binding", "binding_key"][..],
            &["runtimeContract", "executorBinding", "bindingKey"][..],
            &[
                "payload",
                "runtime_contract",
                "executor_binding",
                "binding_key",
            ][..],
            &[
                "payload",
                "runtimeContract",
                "executorBinding",
                "bindingKey",
            ][..],
            &[
                "record",
                "payload",
                "runtime_contract",
                "executor_binding",
                "binding_key",
            ][..],
            &[
                "record",
                "payload",
                "runtimeContract",
                "executorBinding",
                "bindingKey",
            ][..],
        ],
    )
}

fn read_modality_contract_cost_state(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["cost_state", "status"][..],
            &["costState", "status"][..],
            &["payload", "cost_state", "status"][..],
            &["payload", "costState", "status"][..],
            &["record", "payload", "cost_state", "status"][..],
            &["record", "payload", "costState", "status"][..],
            &["task_profile", "cost_state", "status"][..],
            &["taskProfile", "costState", "status"][..],
            &["payload", "task_profile", "cost_state", "status"][..],
            &["payload", "taskProfile", "costState", "status"][..],
            &["runtime_summary", "costStatus"][..],
            &["runtimeSummary", "costStatus"][..],
            &["cost_state"][..],
            &["costState"][..],
            &["payload", "cost_state"][..],
            &["payload", "costState"][..],
            &["record", "payload", "cost_state"][..],
            &["record", "payload", "costState"][..],
        ],
    )
}

fn read_modality_contract_estimated_cost_class(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["cost_state", "estimatedCostClass"][..],
            &["cost_state", "estimated_cost_class"][..],
            &["costState", "estimatedCostClass"][..],
            &["payload", "cost_state", "estimatedCostClass"][..],
            &["payload", "costState", "estimatedCostClass"][..],
            &["record", "payload", "cost_state", "estimatedCostClass"][..],
            &["record", "payload", "costState", "estimatedCostClass"][..],
            &["task_profile", "cost_state", "estimatedCostClass"][..],
            &["taskProfile", "costState", "estimatedCostClass"][..],
            &[
                "payload",
                "task_profile",
                "cost_state",
                "estimatedCostClass",
            ][..],
            &["payload", "taskProfile", "costState", "estimatedCostClass"][..],
            &["runtime_summary", "estimatedCostClass"][..],
            &["runtime_summary", "estimated_cost_class"][..],
            &["runtimeSummary", "estimatedCostClass"][..],
            &["estimated_cost_class"][..],
            &["estimatedCostClass"][..],
        ],
    )
}

fn read_modality_contract_limit_state(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["limit_state", "status"][..],
            &["limitState", "status"][..],
            &["payload", "limit_state", "status"][..],
            &["payload", "limitState", "status"][..],
            &["record", "payload", "limit_state", "status"][..],
            &["record", "payload", "limitState", "status"][..],
            &["task_profile", "limit_state", "status"][..],
            &["taskProfile", "limitState", "status"][..],
            &["payload", "task_profile", "limit_state", "status"][..],
            &["payload", "taskProfile", "limitState", "status"][..],
            &["runtime_summary", "limitStatus"][..],
            &["runtimeSummary", "limitStatus"][..],
            &["limit_state"][..],
            &["limitState"][..],
            &["payload", "limit_state"][..],
            &["payload", "limitState"][..],
            &["record", "payload", "limit_state"][..],
            &["record", "payload", "limitState"][..],
        ],
    )
}

fn read_modality_contract_limit_event_kind(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["limit_event", "eventKind"][..],
            &["limit_event", "event_kind"][..],
            &["limitEvent", "eventKind"][..],
            &["limit_state", "limit_event", "eventKind"][..],
            &["limitState", "limitEvent", "eventKind"][..],
            &["payload", "limit_event", "eventKind"][..],
            &["payload", "limitEvent", "eventKind"][..],
            &["payload", "limit_state", "limit_event", "eventKind"][..],
            &["payload", "limitState", "limitEvent", "eventKind"][..],
            &["record", "payload", "limit_event", "eventKind"][..],
            &["record", "payload", "limitEvent", "eventKind"][..],
            &["runtime_summary", "limitEventKind"][..],
            &["runtime_summary", "limit_event_kind"][..],
            &["runtimeSummary", "limitEventKind"][..],
        ],
    )
}

fn read_modality_contract_quota_low(
    document: &Value,
    limit_event_kind: Option<&str>,
) -> Option<bool> {
    read_json_bool(
        document,
        &[
            &["limit_event", "quotaLow"][..],
            &["limit_event", "quota_low"][..],
            &["limitEvent", "quotaLow"][..],
            &["payload", "limit_event", "quotaLow"][..],
            &["payload", "limitEvent", "quotaLow"][..],
            &["record", "payload", "limit_event", "quotaLow"][..],
            &["record", "payload", "limitEvent", "quotaLow"][..],
            &["runtime_summary", "quotaLow"][..],
            &["runtime_summary", "quota_low"][..],
            &["runtimeSummary", "quotaLow"][..],
        ],
    )
    .or_else(|| {
        limit_event_kind
            .map(|value| value.trim() == "quota_low")
            .filter(|value| *value)
    })
}

fn default_limecore_policy_refs_for_contract(contract_key: &str) -> &'static [&'static str] {
    match contract_key {
        IMAGE_GENERATION_CONTRACT_KEY => IMAGE_GENERATION_LIMECORE_POLICY_REFS,
        BROWSER_CONTROL_CONTRACT_KEY => BROWSER_CONTROL_LIMECORE_POLICY_REFS,
        PDF_EXTRACT_CONTRACT_KEY => PDF_EXTRACT_LIMECORE_POLICY_REFS,
        VOICE_GENERATION_CONTRACT_KEY => VOICE_GENERATION_LIMECORE_POLICY_REFS,
        AUDIO_TRANSCRIPTION_CONTRACT_KEY => AUDIO_TRANSCRIPTION_LIMECORE_POLICY_REFS,
        WEB_RESEARCH_CONTRACT_KEY => WEB_RESEARCH_LIMECORE_POLICY_REFS,
        TEXT_TRANSFORM_CONTRACT_KEY => TEXT_TRANSFORM_LIMECORE_POLICY_REFS,
        _ => &[],
    }
}

fn push_unique_text(values: &mut Vec<String>, candidates: Vec<String>) {
    for candidate in candidates {
        if values.iter().any(|value| value == &candidate) {
            continue;
        }
        values.push(candidate);
    }
}

fn read_limecore_policy_hit_ref(value: &Value) -> Option<String> {
    read_json_string(value, &[&["ref_key"][..], &["refKey"][..], &["ref"][..]])
}

fn read_limecore_policy_hit_status(value: &Value) -> Option<String> {
    read_json_string(value, &[&["status"][..]])
}

fn read_limecore_policy_hit_value_source(value: &Value) -> Option<String> {
    read_json_string(value, &[&["value_source"][..], &["valueSource"][..]])
}

fn limecore_policy_resolved_hit_refs(policy_value_hits: &Value) -> BTreeSet<String> {
    policy_value_hits
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    read_limecore_policy_hit_status(item).as_deref()
                        == Some(LIMECORE_POLICY_VALUE_HIT_STATUS_RESOLVED)
                })
                .filter_map(read_limecore_policy_hit_ref)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default()
}

fn limecore_policy_refs_without_resolved_hits(
    refs: &[String],
    resolved_hit_refs: &BTreeSet<String>,
) -> Vec<String> {
    refs.iter()
        .filter(|ref_key| !resolved_hit_refs.contains(*ref_key))
        .cloned()
        .collect()
}

fn build_limecore_policy_inputs_value(refs: &[String]) -> Value {
    build_limecore_policy_inputs_value_with_hits(refs, &json!([]))
}

fn build_limecore_policy_inputs_value_with_hits(
    refs: &[String],
    policy_value_hits: &Value,
) -> Value {
    let resolved_hit_refs = limecore_policy_resolved_hit_refs(policy_value_hits);
    Value::Array(
        refs.iter()
            .map(|policy_ref| {
                let resolved_hit = policy_value_hits.as_array().and_then(|items| {
                    items.iter().find(|item| {
                        resolved_hit_refs.contains(policy_ref)
                            && read_limecore_policy_hit_ref(item).as_deref()
                                == Some(policy_ref.as_str())
                    })
                });
                json!({
                    "ref_key": policy_ref,
                    "status": resolved_hit
                        .map(|_| LIMECORE_POLICY_INPUT_STATUS_RESOLVED)
                        .unwrap_or(LIMECORE_POLICY_INPUT_STATUS_DECLARED_ONLY),
                    "source": "modality_runtime_contract",
                    "value_source": resolved_hit
                        .and_then(read_limecore_policy_hit_value_source)
                        .unwrap_or_else(|| LIMECORE_POLICY_INPUT_VALUE_SOURCE_LIMECORE_PENDING.to_string()),
                })
            })
            .collect(),
    )
}

fn extract_runtime_contract_limecore_policy_refs(
    document: &Value,
    contract_key: &str,
) -> Vec<String> {
    let mut refs = Vec::new();
    push_unique_text(
        &mut refs,
        read_json_string_array(
            document,
            &[
                &["limecore_policy_refs"][..],
                &["limecorePolicyRefs"][..],
                &["runtime_contract", "limecore_policy_refs"][..],
                &["runtimeContract", "limecorePolicyRefs"][..],
                &["payload", "limecore_policy_refs"][..],
                &["payload", "limecorePolicyRefs"][..],
                &["payload", "runtime_contract", "limecore_policy_refs"][..],
                &["payload", "runtimeContract", "limecorePolicyRefs"][..],
                &["record", "payload", "limecore_policy_refs"][..],
                &["record", "payload", "limecorePolicyRefs"][..],
                &[
                    "record",
                    "payload",
                    "runtime_contract",
                    "limecore_policy_refs",
                ][..],
                &["record", "payload", "runtimeContract", "limecorePolicyRefs"][..],
            ],
        ),
    );
    push_unique_text(
        &mut refs,
        read_json_string_array(
            document,
            &[
                &["limecore_policy_snapshot", "refs"][..],
                &["limecorePolicySnapshot", "refs"][..],
                &["runtime_contract", "limecore_policy_snapshot", "refs"][..],
                &["runtimeContract", "limecorePolicySnapshot", "refs"][..],
                &["payload", "limecore_policy_snapshot", "refs"][..],
                &["payload", "limecorePolicySnapshot", "refs"][..],
                &[
                    "payload",
                    "runtime_contract",
                    "limecore_policy_snapshot",
                    "refs",
                ][..],
                &[
                    "payload",
                    "runtimeContract",
                    "limecorePolicySnapshot",
                    "refs",
                ][..],
                &["record", "payload", "limecore_policy_snapshot", "refs"][..],
                &["record", "payload", "limecorePolicySnapshot", "refs"][..],
                &[
                    "record",
                    "payload",
                    "runtime_contract",
                    "limecore_policy_snapshot",
                    "refs",
                ][..],
                &[
                    "record",
                    "payload",
                    "runtimeContract",
                    "limecorePolicySnapshot",
                    "refs",
                ][..],
            ],
        ),
    );

    if refs.is_empty() {
        refs.extend(
            default_limecore_policy_refs_for_contract(contract_key)
                .iter()
                .map(|value| (*value).to_string()),
        );
    }

    refs
}

fn extract_runtime_contract_limecore_policy_snapshot(
    document: &Value,
    refs: &[String],
) -> Option<Value> {
    if let Some(existing) = find_json_value_at_paths(
        document,
        &[
            &["limecore_policy_snapshot"][..],
            &["limecorePolicySnapshot"][..],
            &["runtime_contract", "limecore_policy_snapshot"][..],
            &["runtimeContract", "limecorePolicySnapshot"][..],
            &["payload", "limecore_policy_snapshot"][..],
            &["payload", "limecorePolicySnapshot"][..],
            &["payload", "runtime_contract", "limecore_policy_snapshot"][..],
            &["payload", "runtimeContract", "limecorePolicySnapshot"][..],
            &["record", "payload", "limecore_policy_snapshot"][..],
            &["record", "payload", "limecorePolicySnapshot"][..],
            &[
                "record",
                "payload",
                "runtime_contract",
                "limecore_policy_snapshot",
            ][..],
            &[
                "record",
                "payload",
                "runtimeContract",
                "limecorePolicySnapshot",
            ][..],
        ],
    )
    .filter(|value| value.is_object())
    {
        let mut snapshot = existing.clone();
        let policy_value_hits = snapshot
            .get("policy_value_hits")
            .or_else(|| snapshot.get("policyValueHits"))
            .filter(|value| value.is_array())
            .cloned()
            .unwrap_or_else(|| json!([]));
        let resolved_hit_refs = limecore_policy_resolved_hit_refs(&policy_value_hits);
        let pending_refs = limecore_policy_refs_without_resolved_hits(refs, &resolved_hit_refs);
        if let Some(object) = snapshot.as_object_mut() {
            object.entry("status".to_string()).or_insert_with(|| {
                Value::String(LIMECORE_POLICY_SNAPSHOT_STATUS_LOCAL_DEFAULTS_EVALUATED.to_string())
            });
            object
                .entry("decision".to_string())
                .or_insert_with(|| Value::String(LIMECORE_POLICY_DECISION_ALLOW.to_string()));
            object
                .entry("source".to_string())
                .or_insert_with(|| Value::String("modality_runtime_contract".to_string()));
            object
                .entry("decision_source".to_string())
                .or_insert_with(|| {
                    Value::String(LIMECORE_POLICY_DECISION_SOURCE_LOCAL_DEFAULT.to_string())
                });
            object
                .entry("decision_scope".to_string())
                .or_insert_with(|| {
                    Value::String(LIMECORE_POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY.to_string())
                });
            object
                .entry("decision_reason".to_string())
                .or_insert_with(|| {
                    Value::String(LIMECORE_POLICY_DECISION_REASON_NO_LOCAL_DENY.to_string())
                });
            if !object.contains_key("refs") {
                object.insert("refs".to_string(), json!(refs));
            }
            if !object.contains_key("evaluated_refs") {
                object.insert(
                    "evaluated_refs".to_string(),
                    json!(resolved_hit_refs.iter().cloned().collect::<Vec<_>>()),
                );
            }
            if !object.contains_key("unresolved_refs") {
                object.insert("unresolved_refs".to_string(), json!(pending_refs.clone()));
            }
            if !object.contains_key("missing_inputs") {
                object.insert("missing_inputs".to_string(), json!(pending_refs.clone()));
            }
            if !object.contains_key("policy_inputs") {
                object.insert(
                    "policy_inputs".to_string(),
                    build_limecore_policy_inputs_value_with_hits(refs, &policy_value_hits),
                );
            }
            if !object.contains_key("pending_hit_refs") {
                object.insert("pending_hit_refs".to_string(), json!(pending_refs.clone()));
            }
            if !object.contains_key("policy_value_hits") {
                object.insert("policy_value_hits".to_string(), policy_value_hits.clone());
            }
            if !object.contains_key("policy_value_hit_count") {
                object.insert(
                    "policy_value_hit_count".to_string(),
                    json!(policy_value_hits
                        .as_array()
                        .map(Vec::len)
                        .unwrap_or_default()),
                );
            }
        }
        return Some(snapshot);
    }

    if refs.is_empty() {
        return None;
    }

    Some(json!({
        "status": LIMECORE_POLICY_SNAPSHOT_STATUS_LOCAL_DEFAULTS_EVALUATED,
        "decision": LIMECORE_POLICY_DECISION_ALLOW,
        "source": "modality_runtime_contract",
        "decision_source": LIMECORE_POLICY_DECISION_SOURCE_LOCAL_DEFAULT,
        "decision_scope": LIMECORE_POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY,
        "decision_reason": LIMECORE_POLICY_DECISION_REASON_NO_LOCAL_DENY,
        "refs": refs,
        "evaluated_refs": [],
        "unresolved_refs": refs,
        "missing_inputs": refs,
        "policy_inputs": build_limecore_policy_inputs_value(refs),
        "pending_hit_refs": refs,
        "policy_value_hits": [],
        "policy_value_hit_count": 0,
    }))
}

fn extract_runtime_contract_execution_profile_key(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["execution_profile_key"][..],
            &["executionProfileKey"][..],
            &["execution_profile", "profile_key"][..],
            &["executionProfile", "profileKey"][..],
            &["runtime_contract", "execution_profile", "profile_key"][..],
            &["runtime_contract", "executionProfile", "profileKey"][..],
            &["runtimeContract", "execution_profile", "profile_key"][..],
            &["runtimeContract", "executionProfile", "profileKey"][..],
            &["payload", "execution_profile_key"][..],
            &["payload", "executionProfileKey"][..],
            &[
                "payload",
                "runtime_contract",
                "execution_profile",
                "profile_key",
            ][..],
            &[
                "payload",
                "runtimeContract",
                "execution_profile",
                "profile_key",
            ][..],
            &[
                "payload",
                "runtimeContract",
                "executionProfile",
                "profileKey",
            ][..],
            &["record", "payload", "execution_profile_key"][..],
            &["record", "payload", "executionProfileKey"][..],
            &[
                "record",
                "payload",
                "runtime_contract",
                "execution_profile",
                "profile_key",
            ][..],
            &[
                "record",
                "payload",
                "runtimeContract",
                "execution_profile",
                "profile_key",
            ][..],
            &[
                "record",
                "payload",
                "runtimeContract",
                "executionProfile",
                "profileKey",
            ][..],
        ],
    )
}

fn extract_runtime_contract_executor_adapter_key(document: &Value) -> Option<String> {
    read_json_string(
        document,
        &[
            &["executor_adapter_key"][..],
            &["executorAdapterKey"][..],
            &["executor_adapter", "adapter_key"][..],
            &["executorAdapter", "adapterKey"][..],
            &["runtime_contract", "executor_adapter", "adapter_key"][..],
            &["runtime_contract", "executorAdapter", "adapterKey"][..],
            &["runtimeContract", "executor_adapter", "adapter_key"][..],
            &["runtimeContract", "executorAdapter", "adapterKey"][..],
            &["payload", "executor_adapter_key"][..],
            &["payload", "executorAdapterKey"][..],
            &[
                "payload",
                "runtime_contract",
                "executor_adapter",
                "adapter_key",
            ][..],
            &[
                "payload",
                "runtimeContract",
                "executor_adapter",
                "adapter_key",
            ][..],
            &[
                "payload",
                "runtimeContract",
                "executorAdapter",
                "adapterKey",
            ][..],
            &["record", "payload", "executor_adapter_key"][..],
            &["record", "payload", "executorAdapterKey"][..],
            &[
                "record",
                "payload",
                "runtime_contract",
                "executor_adapter",
                "adapter_key",
            ][..],
            &[
                "record",
                "payload",
                "runtimeContract",
                "executor_adapter",
                "adapter_key",
            ][..],
            &[
                "record",
                "payload",
                "runtimeContract",
                "executorAdapter",
                "adapterKey",
            ][..],
        ],
    )
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

fn is_modality_runtime_preflight_failure_code(code: &str) -> bool {
    let normalized = code.trim();
    normalized.ends_with("_execution_profile_missing")
        || normalized.ends_with("_execution_profile_mismatch")
        || normalized.ends_with("_executor_adapter_missing")
        || normalized.ends_with("_executor_adapter_mismatch")
        || normalized.ends_with("_executor_binding_missing")
        || normalized.ends_with("_executor_binding_mismatch")
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

fn read_json_usize(value: &Value, paths: &[&[&str]]) -> Option<usize> {
    let resolved = find_json_value_at_paths(value, paths)?;
    match resolved {
        Value::Number(number) => number
            .as_u64()
            .and_then(|value| usize::try_from(value).ok()),
        Value::String(text) => text.trim().parse::<usize>().ok(),
        _ => None,
    }
}

fn json_value_has_content(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(fields) => !fields.is_empty(),
        _ => true,
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
    use crate::commands::modality_runtime_contracts::{
        LIMECORE_POLICY_DECISION_REASON_POLICY_INPUTS_MISSING,
        LIMECORE_POLICY_DECISION_SOURCE_POLICY_INPUT_EVALUATOR,
    };
    use lime_core::database::dao::agent_run::AgentRunStatus;
    use lime_core::database::dao::agent_timeline::{
        AgentThreadItem, AgentThreadItemPayload, AgentThreadItemStatus, AgentThreadTurn,
        AgentThreadTurnStatus,
    };
    use tempfile::TempDir;

    #[test]
    fn extract_limecore_policy_snapshot_should_derive_pending_refs_from_policy_value_hits() {
        let document = json!({
            "runtime_contract": {
                "contract_key": IMAGE_GENERATION_CONTRACT_KEY,
                "limecore_policy_refs": [
                    "model_catalog",
                    "provider_offer",
                    "tenant_feature_flags"
                ],
                "limecore_policy_snapshot": {
                    "refs": [
                        "model_catalog",
                        "provider_offer",
                        "tenant_feature_flags"
                    ],
                    "policy_value_hits": [
                        {
                            "ref_key": "model_catalog",
                            "status": "resolved",
                            "source": "limecore_policy_hit_resolver",
                            "value_source": "local_model_catalog",
                            "value": {
                                "model_id": "gpt-image-1",
                                "capability": "image_generation"
                            }
                        }
                    ]
                }
            }
        });
        let refs =
            extract_runtime_contract_limecore_policy_refs(&document, IMAGE_GENERATION_CONTRACT_KEY);
        let snapshot = extract_runtime_contract_limecore_policy_snapshot(&document, &refs)
            .expect("limecore policy snapshot");

        assert_eq!(snapshot["evaluated_refs"], json!(["model_catalog"]));
        assert_eq!(
            snapshot["pending_hit_refs"],
            json!(["provider_offer", "tenant_feature_flags"])
        );
        assert_eq!(
            snapshot["missing_inputs"],
            json!(["provider_offer", "tenant_feature_flags"])
        );
        assert_eq!(snapshot["policy_value_hit_count"], json!(1));
        assert_eq!(
            snapshot["policy_inputs"][0]["status"],
            json!(LIMECORE_POLICY_INPUT_STATUS_RESOLVED)
        );
        assert_eq!(
            snapshot["policy_inputs"][0]["value_source"],
            json!("local_model_catalog")
        );
    }

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
            permission_state: Some(lime_agent::SessionExecutionRuntimePermissionState {
                status: "requires_confirmation".to_string(),
                required_profile_keys: vec![
                    "read_files".to_string(),
                    "write_artifacts".to_string(),
                ],
                ask_profile_keys: vec!["read_files".to_string(), "write_artifacts".to_string()],
                blocking_profile_keys: Vec::new(),
                decision_source: "modality_execution_profile".to_string(),
                decision_scope: "declared_profile".to_string(),
                confirmation_status: Some("not_requested".to_string()),
                confirmation_request_id: None,
                confirmation_source: Some("declared_profile_only".to_string()),
                notes: vec!["声明态权限摘要，未执行真实授权。".to_string()],
            }),
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

    fn build_completion_audit_owner_run(
        status: AgentRunStatus,
        metadata: Option<Value>,
    ) -> AgentRun {
        AgentRun {
            id: "run-automation-1".to_string(),
            source: "automation".to_string(),
            source_ref: Some("job-1".to_string()),
            session_id: Some("session-1".to_string()),
            status,
            started_at: "2026-05-06T10:00:00Z".to_string(),
            finished_at: Some("2026-05-06T10:01:00Z".to_string()),
            duration_ms: Some(60_000),
            error_code: None,
            error_message: None,
            metadata: metadata.map(|value| value.to_string()),
            created_at: "2026-05-06T10:00:00Z".to_string(),
            updated_at: "2026-05-06T10:01:00Z".to_string(),
        }
    }

    fn build_completion_audit_owner_metadata() -> Value {
        json!({
            "job_id": "job-1",
            "job_name": "只读 CLI 报告｜Managed Agent 草案",
            "harness": {
                "agent_envelope": {
                    "source": "skill_forge_p4_agent_envelope",
                    "skill": "project:capability-report",
                    "source_draft_id": "capdraft-1",
                    "source_verification_report_id": "capver-1"
                },
                "managed_objective": {
                    "source": "skill_forge_p4_managed_execution",
                    "owner_type": "automation_job",
                    "completion_audit": "artifact_or_evidence_required"
                },
                "workspace_skill_runtime_enable": {
                    "source": "agent_envelope_scheduled_run",
                    "approval": "manual",
                    "workspace_root": "/tmp/work",
                    "bindings": [
                        {
                            "directory": "capability-report",
                            "skill": "project:capability-report",
                            "source_draft_id": "capdraft-1",
                            "source_verification_report_id": "capver-1"
                        }
                    ]
                }
            }
        })
    }

    fn build_completion_audit_owner_metadata_requiring_controlled_get() -> Value {
        let mut metadata = build_completion_audit_owner_metadata();
        if let Some(managed_objective) = metadata.pointer_mut("/harness/managed_objective") {
            managed_objective["completion_evidence_policy"] = json!({
                "controlled_get_evidence_required": true,
                "controlled_get_evidence_source": "capability_draft_controlled_get_evidence"
            });
            managed_objective["required_external_evidence"] = json!(["controlled_get_evidence"]);
        }
        metadata
    }

    fn write_controlled_get_evidence_fixture(workspace_root: &Path, session_id: &str) {
        let evidence_dir = workspace_root
            .join(".lime")
            .join("capability-drafts")
            .join("controlled-get-evidence");
        fs::create_dir_all(evidence_dir.as_path()).expect("create controlled get evidence dir");
        let artifact_id = format!("controlled-get-fixture-{session_id}");
        let artifact = json!({
            "artifactId": artifact_id,
            "artifactKind": "capability_draft_controlled_get_evidence",
            "schemaVersion": 1,
            "approvalId": "approval-readonly-api",
            "sessionId": session_id,
            "status": "executed",
            "scope": "session",
            "gateId": "readonly_http_controlled_get_execution",
            "method": "GET",
            "methodAllowed": true,
            "requestUrlHash": "request-url-hash-fixture",
            "requestUrlHashAlgorithm": "sha256",
            "responseStatus": 200,
            "responseSha256": "response-sha256-fixture",
            "responseBytes": 17,
            "responsePreviewTruncated": false,
            "executedAt": "2026-05-07T10:00:00Z",
            "networkRequestSent": true,
            "responseCaptured": true,
            "endpointValueReturned": false,
            "endpointInputPersisted": false,
            "credentialReferenceId": "readonly_api_session",
            "credentialResolved": false,
            "tokenPersisted": false,
            "runtimeExecutionEnabled": false,
            "valueRetention": "hash_and_metadata_only",
            "containsEndpointValue": false,
            "containsTokenValue": false,
            "containsResponsePreview": false,
            "endpointValue": "https://api.example.com/secret",
            "tokenValue": "secret-token",
            "responsePreview": "{\"ok\":true}",
            "evidence": [
                {"key": "request_url_hash", "value": "request-url-hash-fixture"},
                {"key": "response_sha256", "value": "response-sha256-fixture"},
                {"key": "response_preview_sha256", "value": "preview-sha256-fixture"}
            ]
        });
        fs::write(
            evidence_dir.join(format!("controlled-get-fixture-{session_id}.json")),
            serde_json::to_string_pretty(&artifact).expect("serialize controlled get artifact"),
        )
        .expect("write controlled get artifact");
    }

    #[test]
    fn timeline_should_preserve_workspace_skill_source_metadata_for_agent_envelope() {
        let mut detail = build_detail();
        detail.items.push(AgentThreadItem {
            id: "workspace-skill-tool-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-05-06T10:00:40Z".to_string(),
            completed_at: Some("2026-05-06T10:00:41Z".to_string()),
            updated_at: "2026-05-06T10:00:41Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "project:capability-report".to_string(),
                arguments: Some(json!({
                    "input": "daily report"
                })),
                output: Some("ok".to_string()),
                success: Some(true),
                error: None,
                metadata: Some(json!({
                    "tool_family": "skill",
                    "skill_name": "project:capability-report",
                    "workspace_skill_source": {
                        "workspaceRoot": "/tmp/work",
                        "source": "manual_session_enable",
                        "approval": "manual",
                        "authorizationScope": "session",
                        "directory": "capability-report",
                        "registeredSkillDirectory": "/tmp/work/.agents/skills/capability-report",
                        "skillName": "project:capability-report",
                        "sourceDraftId": "capdraft-1",
                        "sourceVerificationReportId": "capver-1",
                        "permissionSummary": ["Level 0 只读发现"]
                    },
                    "workspace_skill_runtime_enable": {
                        "source": "manual_session_enable",
                        "approval": "manual",
                        "authorization_scope": "session",
                        "workspace_root": "/tmp/work",
                        "directory": "capability-report",
                        "skill": "project:capability-report",
                        "registered_skill_directory": "/tmp/work/.agents/skills/capability-report",
                        "source_draft_id": "capdraft-1",
                        "source_verification_report_id": "capver-1",
                        "permission_summary": ["Level 0 只读发现"]
                    }
                })),
            },
        });

        let timeline = build_timeline_json(&detail, "2026-05-06T10:01:00Z").expect("timeline json");
        let value = serde_json::from_str::<Value>(&timeline).expect("parse timeline");
        let tool_item = value["items"]
            .as_array()
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("id").and_then(Value::as_str) == Some("workspace-skill-tool-1")
                })
            })
            .expect("workspace skill timeline item");

        assert_eq!(
            tool_item.pointer("/workspaceSkillToolCall/toolName"),
            Some(&json!("project:capability-report"))
        );
        assert_eq!(
            tool_item.pointer("/workspaceSkillToolCall/workspaceSkillSource/sourceDraftId"),
            Some(&json!("capdraft-1"))
        );
        assert_eq!(
            tool_item
                .pointer("/workspaceSkillToolCall/workspaceSkillRuntimeEnable/source_draft_id"),
            Some(&json!("capdraft-1"))
        );
        assert_eq!(
            tool_item.pointer("/workspaceSkillToolCall/workspaceSkillSource/authorizationScope"),
            Some(&json!("session"))
        );
    }

    #[test]
    fn evidence_pack_should_export_automation_owner_agent_envelope_metadata() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        detail.items.push(AgentThreadItem {
            id: "workspace-skill-tool-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-05-06T10:00:40Z".to_string(),
            completed_at: Some("2026-05-06T10:00:41Z".to_string()),
            updated_at: "2026-05-06T10:00:41Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "project:capability-report".to_string(),
                arguments: Some(json!({
                    "input": "daily report"
                })),
                output: Some("ok".to_string()),
                success: Some(true),
                error: None,
                metadata: Some(json!({
                    "workspace_skill_source": {
                        "workspaceRoot": "/tmp/work",
                        "authorizationScope": "session",
                        "sourceDraftId": "capdraft-1"
                    },
                    "workspace_skill_runtime_enable": {
                        "source": "agent_envelope_scheduled_run",
                        "skill": "project:capability-report",
                        "source_draft_id": "capdraft-1"
                    }
                })),
            },
        });
        let thread_read = build_thread_read();
        let owner_runs = vec![build_completion_audit_owner_run(
            AgentRunStatus::Success,
            Some(build_completion_audit_owner_metadata()),
        )];

        let export_result = export_runtime_evidence_pack_with_owner_runs(
            &detail,
            &thread_read,
            temp_dir.path(),
            &owner_runs,
        )
        .expect("export");
        assert_eq!(
            export_result.completion_audit_summary.pointer("/decision"),
            Some(&json!("completed"))
        );

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime = fs::read_to_string(runtime_path).expect("runtime");
        let runtime = serde_json::from_str::<Value>(&runtime).expect("runtime json");

        assert_eq!(runtime.pointer("/automationOwners/count"), Some(&json!(1)));
        assert_eq!(
            runtime.pointer("/automationOwners/runs/0/sourceRef"),
            Some(&json!("job-1"))
        );
        assert_eq!(
            runtime.pointer("/automationOwners/runs/0/agentEnvelope/source_draft_id"),
            Some(&json!("capdraft-1"))
        );
        assert_eq!(
            runtime.pointer("/automationOwners/runs/0/managedObjective/owner_type"),
            Some(&json!("automation_job"))
        );
        assert_eq!(
            runtime
                .pointer("/automationOwners/runs/0/workspaceSkillRuntimeEnable/bindings/0/skill"),
            Some(&json!("project:capability-report"))
        );
        assert_eq!(
            runtime.pointer("/automationOwners/runs/0/completionAudit/status"),
            Some(&json!("audit_input_ready"))
        );
        assert_eq!(
            runtime.pointer("/automationOwners/runs/0/completionAudit/completionDecision"),
            Some(&json!("not_completed"))
        );
        assert_eq!(
            runtime.pointer(
                "/automationOwners/runs/0/completionAudit/evidenceInputs/workspaceSkillRuntimeEnable"
            ),
            Some(&json!(true))
        );
        assert_eq!(
            runtime.pointer("/completionAuditSummary/decision"),
            Some(&json!("completed"))
        );
        assert_eq!(
            runtime.pointer("/completionAuditSummary/requiredEvidence/automationOwner"),
            Some(&json!(true))
        );
        assert_eq!(
            runtime.pointer("/completionAuditSummary/requiredEvidence/workspaceSkillToolCall"),
            Some(&json!(true))
        );
        assert_eq!(
            runtime.pointer("/completionAuditSummary/requiredEvidence/artifactOrTimeline"),
            Some(&json!(true))
        );
        assert_eq!(
            runtime.pointer("/completionAuditSummary/requiredEvidence/controlledGetEvidence"),
            Some(&json!(false))
        );

        let artifacts_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/artifacts.json");
        let artifacts = fs::read_to_string(artifacts_path).expect("artifacts");
        let artifacts = serde_json::from_str::<Value>(&artifacts).expect("artifacts json");

        assert_eq!(
            artifacts.pointer("/completionAuditSummary/decision"),
            Some(&json!("completed"))
        );

        let summary_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/summary.md");
        let summary = fs::read_to_string(summary_path).expect("summary");
        assert!(summary.contains("## Completion Audit"));
        assert!(summary.contains("- 判定：`completed`"));
        assert!(summary.contains("- Workspace Skill ToolCall evidence：1"));
    }

    #[test]
    fn evidence_pack_should_project_controlled_get_evidence_without_sensitive_values() {
        let temp_dir = TempDir::new().expect("temp dir");
        let detail = build_detail();
        let mut thread_read = build_thread_read();
        if let Some(permission_state) = thread_read.permission_state.as_mut() {
            permission_state.confirmation_status = Some("resolved".to_string());
            permission_state.confirmation_request_id = Some("approval-resolved".to_string());
        }
        write_controlled_get_evidence_fixture(temp_dir.path(), "session-1");
        write_controlled_get_evidence_fixture(temp_dir.path(), "other-session");

        export_runtime_evidence_pack(&detail, &thread_read, temp_dir.path()).expect("export");

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime_raw = fs::read_to_string(runtime_path).expect("runtime");
        assert!(!runtime_raw.contains("https://api.example.com/secret"));
        assert!(!runtime_raw.contains("secret-token"));
        assert!(!runtime_raw.contains("{\\\"ok\\\":true}"));
        let runtime = serde_json::from_str::<Value>(&runtime_raw).expect("runtime json");
        assert_eq!(
            runtime.pointer("/capabilityDraftControlledGetEvidence/artifactCount"),
            Some(&json!(1))
        );
        assert_eq!(
            runtime.pointer("/capabilityDraftControlledGetEvidence/artifacts/0/requestUrlHash"),
            Some(&json!("request-url-hash-fixture"))
        );
        assert_eq!(
            runtime.pointer(
                "/capabilityDraftControlledGetEvidence/artifacts/0/safety/containsEndpointValue"
            ),
            Some(&json!(false))
        );
        assert_eq!(
            runtime.pointer("/completionAuditSummary/requiredEvidence/controlledGetEvidence"),
            Some(&json!(true))
        );
        assert_eq!(
            runtime.pointer("/completionAuditSummary/controlledGetEvidenceExecutedCount"),
            Some(&json!(1))
        );

        let artifacts_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/artifacts.json");
        let artifacts = fs::read_to_string(artifacts_path).expect("artifacts");
        assert!(artifacts.contains("\"capabilityDraftControlledGetEvidence\""));
        assert!(artifacts.contains("\"response_preview_sha256\""));
        assert!(!artifacts.contains("https://api.example.com/secret"));
        assert!(!artifacts.contains("secret-token"));
        assert!(!artifacts.contains("{\\\"ok\\\":true}"));

        let summary_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/summary.md");
        let summary = fs::read_to_string(summary_path).expect("summary");
        assert!(summary.contains("- 受控 GET evidence：1"));
        assert!(summary.contains("- 受控 GET evidence artifact：1"));
    }

    #[test]
    fn evidence_pack_should_complete_readonly_http_policy_only_with_controlled_get_evidence() {
        let mut detail = build_detail();
        add_successful_workspace_skill_tool_call(&mut detail);
        let thread_read = build_thread_read();
        let owner_runs = vec![build_completion_audit_owner_run(
            AgentRunStatus::Success,
            Some(build_completion_audit_owner_metadata_requiring_controlled_get()),
        )];

        let missing_evidence_dir = TempDir::new().expect("missing evidence temp dir");
        let missing_result = export_runtime_evidence_pack_with_owner_runs(
            &detail,
            &thread_read,
            missing_evidence_dir.path(),
            &owner_runs,
        )
        .expect("export without controlled get evidence");
        assert_eq!(
            missing_result.completion_audit_summary.pointer("/decision"),
            Some(&json!("verifying"))
        );
        assert_eq!(
            missing_result
                .completion_audit_summary
                .pointer("/controlledGetEvidenceRequired"),
            Some(&json!(true))
        );
        assert!(missing_result
            .completion_audit_summary
            .pointer("/blockingReasons")
            .and_then(Value::as_array)
            .expect("blocking reasons")
            .contains(&json!("missing_controlled_get_evidence")));

        let completed_dir = TempDir::new().expect("completed evidence temp dir");
        write_controlled_get_evidence_fixture(completed_dir.path(), "session-1");
        let completed_result = export_runtime_evidence_pack_with_owner_runs(
            &detail,
            &thread_read,
            completed_dir.path(),
            &owner_runs,
        )
        .expect("export with controlled get evidence");
        assert_eq!(
            completed_result
                .completion_audit_summary
                .pointer("/decision"),
            Some(&json!("completed"))
        );
        assert_eq!(
            completed_result
                .completion_audit_summary
                .pointer("/requiredEvidence/controlledGetEvidence"),
            Some(&json!(true))
        );

        let runtime_path = completed_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime_raw = fs::read_to_string(runtime_path).expect("runtime");
        assert!(!runtime_raw.contains("https://api.example.com/secret"));
        assert!(!runtime_raw.contains("secret-token"));
        assert!(!runtime_raw.contains("{\\\"ok\\\":true}"));
        let runtime = serde_json::from_str::<Value>(&runtime_raw).expect("runtime json");
        assert_eq!(
            runtime.pointer("/completionAuditSummary/decision"),
            Some(&json!("completed"))
        );
        assert_eq!(
            runtime.pointer("/completionAuditSummary/controlledGetEvidenceRequired"),
            Some(&json!(true))
        );
        assert_eq!(
            runtime.pointer("/completionAuditSummary/controlledGetEvidenceExecutedCount"),
            Some(&json!(1))
        );
        assert_eq!(
            runtime.pointer("/capabilityDraftControlledGetEvidence/artifactCount"),
            Some(&json!(1))
        );

        let summary_path = completed_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/summary.md");
        let summary = fs::read_to_string(summary_path).expect("summary");
        assert!(summary.contains("- 判定：`completed`"));
        assert!(summary.contains("- 受控 GET evidence：1 / 1 executed"));
    }

    #[test]
    fn skill_forge_p5_readonly_report_artifact_should_complete_agent_envelope_audit() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        detail.name = "P5 只读 CLI 每日报告".to_string();
        if let AgentThreadItemPayload::FileArtifact { path, metadata, .. } =
            &mut detail.items[1].payload
        {
            *path = ".lime/artifacts/thread-1/daily-readonly-cli-report.md".to_string();
            *metadata = Some(json!({
                "source": "skill_forge_p5_prompt_to_artifact_smoke",
                "artifactKind": "markdown_report",
                "permissionLevel": "read_only",
                "title": "只读 CLI 每日报告"
            }));
        }
        detail.items.push(AgentThreadItem {
            id: "workspace-skill-tool-p5".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-05-06T10:00:40Z".to_string(),
            completed_at: Some("2026-05-06T10:00:41Z".to_string()),
            updated_at: "2026-05-06T10:00:41Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "project:capability-report".to_string(),
                arguments: Some(json!({
                    "topic": "AI Agent adoption",
                    "fixture_path": "tests/fixture.json"
                })),
                output: Some("已生成 Markdown 趋势摘要。".to_string()),
                success: Some(true),
                error: None,
                metadata: Some(json!({
                    "workspace_skill_source": {
                        "workspaceRoot": "/tmp/work",
                        "authorizationScope": "session",
                        "directory": "capability-report",
                        "registeredSkillDirectory": "/tmp/work/.agents/skills/capability-report",
                        "skillName": "project:capability-report",
                        "sourceDraftId": "capdraft-1",
                        "sourceVerificationReportId": "capver-1",
                        "permissionSummary": ["Level 0 只读发现"]
                    },
                    "workspace_skill_runtime_enable": {
                        "source": "agent_envelope_scheduled_run",
                        "approval": "manual",
                        "authorization_scope": "session",
                        "workspace_root": "/tmp/work",
                        "directory": "capability-report",
                        "skill": "project:capability-report",
                        "registered_skill_directory": "/tmp/work/.agents/skills/capability-report",
                        "source_draft_id": "capdraft-1",
                        "source_verification_report_id": "capver-1",
                        "permission_summary": ["Level 0 只读发现"]
                    }
                })),
            },
        });
        let owner_runs = vec![build_completion_audit_owner_run(
            AgentRunStatus::Success,
            Some(build_completion_audit_owner_metadata()),
        )];

        let export_result = export_runtime_evidence_pack_with_owner_runs(
            &detail,
            &build_thread_read(),
            temp_dir.path(),
            &owner_runs,
        )
        .expect("export");

        assert_eq!(
            export_result.completion_audit_summary.pointer("/decision"),
            Some(&json!("completed"))
        );
        assert_eq!(
            export_result
                .completion_audit_summary
                .pointer("/requiredEvidence/automationOwner"),
            Some(&json!(true))
        );
        assert_eq!(
            export_result
                .completion_audit_summary
                .pointer("/requiredEvidence/workspaceSkillToolCall"),
            Some(&json!(true))
        );
        assert_eq!(
            export_result
                .completion_audit_summary
                .pointer("/requiredEvidence/artifactOrTimeline"),
            Some(&json!(true))
        );

        let artifacts_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/artifacts.json");
        let artifacts = fs::read_to_string(artifacts_path).expect("artifacts");
        let artifacts = serde_json::from_str::<Value>(&artifacts).expect("artifacts json");
        assert_eq!(
            artifacts.pointer("/recentArtifacts/0"),
            Some(&json!(
                ".lime/artifacts/thread-1/daily-readonly-cli-report.md"
            ))
        );

        let runtime_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/runtime.json");
        let runtime = fs::read_to_string(runtime_path).expect("runtime");
        let runtime = serde_json::from_str::<Value>(&runtime).expect("runtime json");
        assert_eq!(
            runtime.pointer("/automationOwners/runs/0/completionAudit/status"),
            Some(&json!("audit_input_ready"))
        );
        assert_eq!(
            runtime.pointer("/completionAuditSummary/decision"),
            Some(&json!("completed"))
        );

        let timeline_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/timeline.json");
        let timeline = fs::read_to_string(timeline_path).expect("timeline");
        let timeline = serde_json::from_str::<Value>(&timeline).expect("timeline json");
        let tool_item = timeline["items"]
            .as_array()
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("id").and_then(Value::as_str) == Some("workspace-skill-tool-p5")
                })
            })
            .expect("workspace skill timeline item");
        assert_eq!(
            tool_item.pointer("/workspaceSkillToolCall/workspaceSkillSource/sourceDraftId"),
            Some(&json!("capdraft-1"))
        );
    }

    #[test]
    fn completion_audit_summary_should_classify_negative_paths() {
        let detail = build_detail();
        let recent_artifacts = vec![".lime/artifacts/thread-1/report.md".to_string()];
        let controlled_get_evidence = RuntimeCapabilityDraftControlledGetEvidenceSummary::default();

        let missing_owner = build_completion_audit_summary_json(
            &[],
            &detail,
            &recent_artifacts,
            &controlled_get_evidence,
        );
        assert_eq!(
            missing_owner.pointer("/decision"),
            Some(&json!("needs_input"))
        );
        assert!(missing_owner["blockingReasons"]
            .as_array()
            .expect("blocking reasons")
            .contains(&json!("missing_automation_owner")));

        let blocked_run = build_completion_audit_summary_json(
            &[build_completion_audit_owner_run(
                AgentRunStatus::Error,
                Some(build_completion_audit_owner_metadata()),
            )],
            &detail,
            &recent_artifacts,
            &controlled_get_evidence,
        );
        assert_eq!(blocked_run.pointer("/decision"), Some(&json!("blocked")));
        assert!(blocked_run["blockingReasons"]
            .as_array()
            .expect("blocking reasons")
            .contains(&json!("blocked_by_automation_owner_run_status")));

        let missing_inputs = build_completion_audit_summary_json(
            &[build_completion_audit_owner_run(
                AgentRunStatus::Success,
                None,
            )],
            &detail,
            &recent_artifacts,
            &controlled_get_evidence,
        );
        assert_eq!(
            missing_inputs.pointer("/decision"),
            Some(&json!("needs_input"))
        );
        assert!(missing_inputs["blockingReasons"]
            .as_array()
            .expect("blocking reasons")
            .contains(&json!("missing_automation_owner_audit_inputs")));

        let missing_tool_evidence = build_completion_audit_summary_json(
            &[build_completion_audit_owner_run(
                AgentRunStatus::Success,
                Some(build_completion_audit_owner_metadata()),
            )],
            &detail,
            &recent_artifacts,
            &controlled_get_evidence,
        );
        assert_eq!(
            missing_tool_evidence.pointer("/decision"),
            Some(&json!("verifying"))
        );
        assert_eq!(
            missing_tool_evidence.pointer("/requiredEvidence/workspaceSkillToolCall"),
            Some(&json!(false))
        );
        assert!(missing_tool_evidence["blockingReasons"]
            .as_array()
            .expect("blocking reasons")
            .contains(&json!("missing_workspace_skill_tool_call_evidence")));
    }

    fn build_executed_controlled_get_evidence_summary_fixture(
    ) -> RuntimeCapabilityDraftControlledGetEvidenceSummary {
        RuntimeCapabilityDraftControlledGetEvidenceSummary {
            scanned_artifact_count: 1,
            skipped_unsafe_artifact_count: 0,
            artifacts: vec![json!({
                "artifactId": "controlled-get-fixture-session-1",
                "artifactKind": "capability_draft_controlled_get_evidence",
                "relativePath": ".lime/capability-drafts/controlled-get-evidence/controlled-get-fixture-session-1.json",
                "contentSha256": "content-sha256-fixture",
                "status": "executed",
                "requestUrlHash": "request-url-hash-fixture",
                "responseSha256": "response-sha256-fixture",
                "networkRequestSent": true,
                "responseCaptured": true,
                "endpointValue": "https://api.example.com/secret",
                "tokenValue": "secret-token",
                "responsePreview": "{\"ok\":true}"
            })],
        }
    }

    fn add_successful_workspace_skill_tool_call(detail: &mut SessionDetail) {
        detail.items.push(AgentThreadItem {
            id: "workspace-skill-tool-controlled-get".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-05-06T10:00:40Z".to_string(),
            completed_at: Some("2026-05-06T10:00:41Z".to_string()),
            updated_at: "2026-05-06T10:00:41Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "project:capability-report".to_string(),
                arguments: Some(json!({
                    "input": "readonly api report"
                })),
                output: Some("ok".to_string()),
                success: Some(true),
                error: None,
                metadata: Some(json!({
                    "workspace_skill_source": {
                        "sourceDraftId": "capdraft-1",
                        "sourceVerificationReportId": "capver-1"
                    },
                    "workspace_skill_runtime_enable": {
                        "source": "agent_envelope_scheduled_run",
                        "skill": "project:capability-report"
                    }
                })),
            },
        });
    }

    #[test]
    fn completion_audit_should_track_controlled_get_evidence_without_completing_alone() {
        let mut detail = build_detail();
        detail.items.retain(|item| {
            !matches!(item.payload, AgentThreadItemPayload::FileArtifact { .. })
                && !matches!(item.payload, AgentThreadItemPayload::ToolCall { .. })
        });
        let recent_artifacts = Vec::<String>::new();
        let controlled_get_evidence = build_executed_controlled_get_evidence_summary_fixture();

        let summary = build_completion_audit_summary_json(
            &[build_completion_audit_owner_run(
                AgentRunStatus::Success,
                Some(build_completion_audit_owner_metadata()),
            )],
            &detail,
            &recent_artifacts,
            &controlled_get_evidence,
        );

        assert_eq!(summary.pointer("/decision"), Some(&json!("verifying")));
        assert_eq!(
            summary.pointer("/controlledGetEvidenceArtifactCount"),
            Some(&json!(1))
        );
        assert_eq!(
            summary.pointer("/controlledGetEvidenceExecutedCount"),
            Some(&json!(1))
        );
        assert_eq!(
            summary.pointer("/controlledGetEvidenceStatusCounts/executed"),
            Some(&json!(1))
        );
        assert_eq!(
            summary.pointer("/requiredEvidence/controlledGetEvidence"),
            Some(&json!(true))
        );
        assert_eq!(
            summary.pointer("/requiredEvidence/workspaceSkillToolCall"),
            Some(&json!(false))
        );
        assert!(summary["blockingReasons"]
            .as_array()
            .expect("blocking reasons")
            .contains(&json!("missing_workspace_skill_tool_call_evidence")));

        let serialized =
            serde_json::to_string(&summary).expect("serialize completion audit summary");
        assert!(!serialized.contains("https://api.example.com/secret"));
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("{\"ok\":true}"));
    }

    #[test]
    fn completion_audit_should_require_controlled_get_evidence_when_owner_declares_policy() {
        let mut detail = build_detail();
        add_successful_workspace_skill_tool_call(&mut detail);
        let recent_artifacts = vec![".lime/artifacts/thread-1/report.md".to_string()];

        let missing_controlled_get = build_completion_audit_summary_json(
            &[build_completion_audit_owner_run(
                AgentRunStatus::Success,
                Some(build_completion_audit_owner_metadata_requiring_controlled_get()),
            )],
            &detail,
            &recent_artifacts,
            &RuntimeCapabilityDraftControlledGetEvidenceSummary::default(),
        );

        assert_eq!(
            missing_controlled_get.pointer("/decision"),
            Some(&json!("verifying"))
        );
        assert_eq!(
            missing_controlled_get.pointer("/controlledGetEvidenceRequired"),
            Some(&json!(true))
        );
        assert_eq!(
            missing_controlled_get.pointer("/requiredEvidence/controlledGetEvidence"),
            Some(&json!(false))
        );
        assert!(missing_controlled_get["blockingReasons"]
            .as_array()
            .expect("blocking reasons")
            .contains(&json!("missing_controlled_get_evidence")));

        let with_controlled_get = build_completion_audit_summary_json(
            &[build_completion_audit_owner_run(
                AgentRunStatus::Success,
                Some(build_completion_audit_owner_metadata_requiring_controlled_get()),
            )],
            &detail,
            &recent_artifacts,
            &build_executed_controlled_get_evidence_summary_fixture(),
        );

        assert_eq!(
            with_controlled_get.pointer("/decision"),
            Some(&json!("completed"))
        );
        assert_eq!(
            with_controlled_get.pointer("/controlledGetEvidenceRequired"),
            Some(&json!(true))
        );
        assert_eq!(
            with_controlled_get.pointer("/requiredEvidence/controlledGetEvidence"),
            Some(&json!(true))
        );
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
    fn permission_state_signal_coverage_should_surface_denied_confirmation_as_blocked() {
        let mut thread_read = build_thread_read();
        let mut permission_state = thread_read
            .permission_state
            .clone()
            .expect("permission state");
        permission_state.confirmation_status = Some("denied".to_string());
        permission_state.confirmation_request_id = Some("approval-denied".to_string());
        permission_state.confirmation_source = Some("runtime_action_required".to_string());
        thread_read.permission_state = Some(permission_state);

        let coverage = permission_state_signal_coverage(&thread_read);

        assert_eq!(coverage.signal, "permissionState");
        assert_eq!(coverage.status, "blocked");
        assert!(coverage.detail.contains("approval-denied"));
        assert!(coverage.detail.contains("真实权限确认已被拒绝"));
    }

    #[test]
    fn permission_state_signal_coverage_should_surface_resolved_confirmation_as_exported() {
        let mut thread_read = build_thread_read();
        let mut permission_state = thread_read
            .permission_state
            .clone()
            .expect("permission state");
        permission_state.confirmation_status = Some("resolved".to_string());
        permission_state.confirmation_request_id = Some("approval-resolved".to_string());
        permission_state.confirmation_source = Some("runtime_action_required".to_string());
        thread_read.permission_state = Some(permission_state);

        let coverage = permission_state_signal_coverage(&thread_read);

        assert_eq!(coverage.signal, "permissionState");
        assert_eq!(coverage.status, "exported");
        assert!(coverage.detail.contains("approval-resolved"));
        assert!(coverage.detail.contains("真实权限确认已通过"));
    }

    #[test]
    fn permission_state_signal_coverage_should_surface_not_requested_confirmation_as_blocked() {
        let thread_read = build_thread_read();

        let coverage = permission_state_signal_coverage(&thread_read);

        assert_eq!(coverage.signal, "permissionState");
        assert_eq!(coverage.status, "blocked");
        assert!(coverage.detail.contains("尚未发起 ApprovalRequest"));
        assert!(coverage.detail.contains("read_files"));
        assert!(coverage.detail.contains("write_artifacts"));
    }

    #[test]
    fn permission_state_signal_coverage_should_surface_requested_confirmation_as_blocked() {
        let mut thread_read = build_thread_read();
        let mut permission_state = thread_read
            .permission_state
            .clone()
            .expect("permission state");
        permission_state.confirmation_status = Some("requested".to_string());
        permission_state.confirmation_request_id = Some("approval-pending".to_string());
        permission_state.confirmation_source = Some("runtime_action_required".to_string());
        thread_read.permission_state = Some(permission_state);

        let coverage = permission_state_signal_coverage(&thread_read);

        assert_eq!(coverage.signal, "permissionState");
        assert_eq!(coverage.status, "blocked");
        assert!(coverage.detail.contains("真实权限确认正在等待处理"));
        assert!(coverage.detail.contains("approval-pending"));
    }

    #[test]
    fn known_gaps_should_surface_denied_permission_confirmation() {
        let mut thread_read = build_thread_read();
        let mut permission_state = thread_read
            .permission_state
            .clone()
            .expect("permission state");
        permission_state.confirmation_status = Some("denied".to_string());
        permission_state.confirmation_request_id = Some("approval-denied".to_string());
        permission_state.confirmation_source = Some("runtime_action_required".to_string());
        thread_read.permission_state = Some(permission_state);

        let gaps = build_known_gaps(&[], &[], &thread_read);

        assert!(gaps.iter().any(|gap| gap.contains("approval-denied")));
        assert!(gaps.iter().any(|gap| gap.contains("权限确认已被拒绝")));
    }

    #[test]
    fn known_gaps_should_surface_not_requested_permission_confirmation() {
        let thread_read = build_thread_read();

        let gaps = build_known_gaps(&[], &[], &thread_read);

        assert!(gaps
            .iter()
            .any(|gap| gap.contains("尚未发起 ApprovalRequest")));
        assert!(gaps.iter().any(|gap| gap.contains("read_files")));
    }

    #[test]
    fn known_gaps_should_surface_user_locked_capability_gap() {
        let mut thread_read = build_thread_read();
        thread_read.permission_state = None;
        thread_read.capability_gap = Some("browser_reasoning_candidate_missing".to_string());
        thread_read.limit_state = Some(lime_agent::SessionExecutionRuntimeLimitState {
            status: "user_locked_capability_gap".to_string(),
            single_candidate_only: true,
            provider_locked: false,
            settings_locked: true,
            oem_locked: false,
            candidate_count: 1,
            capability_gap: Some("browser_reasoning_candidate_missing".to_string()),
            notes: vec!["显式模型锁定不满足 browser_reasoning routingSlot".to_string()],
        });

        let gaps = build_known_gaps(&[], &[], &thread_read);

        assert!(gaps.iter().any(|gap| gap.contains("显式用户模型锁定")));
        assert!(gaps
            .iter()
            .any(|gap| gap.contains("browser_reasoning_candidate_missing")));
    }

    #[test]
    fn known_gaps_should_not_surface_resolved_permission_confirmation() {
        let mut thread_read = build_thread_read();
        let mut permission_state = thread_read
            .permission_state
            .clone()
            .expect("permission state");
        permission_state.confirmation_status = Some("resolved".to_string());
        permission_state.confirmation_request_id = Some("approval-resolved".to_string());
        permission_state.confirmation_source = Some("runtime_action_required".to_string());
        thread_read.permission_state = Some(permission_state);

        let gaps = build_known_gaps(&[], &[], &thread_read);

        assert!(!gaps.iter().any(|gap| gap.contains("approval-resolved")));
        assert!(!gaps.iter().any(|gap| gap.contains("权限确认已被拒绝")));
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
                        "execution_profile": {
                            "profile_key": "image_generation_profile"
                        },
                        "executor_adapter": {
                            "adapter_key": "skill:image_generate"
                        },
                        "limecore_policy_refs": IMAGE_GENERATION_LIMECORE_POLICY_REFS,
                        "limecore_policy_snapshot": {
                            "status": LIMECORE_POLICY_SNAPSHOT_STATUS_LOCAL_DEFAULTS_EVALUATED,
                            "decision": LIMECORE_POLICY_DECISION_ALLOW,
                            "source": "modality_runtime_contract",
                            "decision_source": LIMECORE_POLICY_DECISION_SOURCE_LOCAL_DEFAULT,
                            "decision_scope": LIMECORE_POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY,
                            "decision_reason": LIMECORE_POLICY_DECISION_REASON_NO_LOCAL_DENY,
                            "refs": IMAGE_GENERATION_LIMECORE_POLICY_REFS,
                            "evaluated_refs": [],
                            "unresolved_refs": IMAGE_GENERATION_LIMECORE_POLICY_REFS,
                            "missing_inputs": IMAGE_GENERATION_LIMECORE_POLICY_REFS,
                            "pending_hit_refs": IMAGE_GENERATION_LIMECORE_POLICY_REFS,
                            "policy_value_hits": [],
                            "policy_value_hit_count": 0,
                            "policy_evaluation": {
                                "status": "input_gap",
                                "decision": "ask",
                                "decision_source": LIMECORE_POLICY_DECISION_SOURCE_POLICY_INPUT_EVALUATOR,
                                "decision_scope": "pending_policy_inputs",
                                "decision_reason": LIMECORE_POLICY_DECISION_REASON_POLICY_INPUTS_MISSING,
                                "blocking_refs": [],
                                "ask_refs": IMAGE_GENERATION_LIMECORE_POLICY_REFS,
                                "pending_refs": IMAGE_GENERATION_LIMECORE_POLICY_REFS
                            }
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
                        "status": "completed",
                        "audio_path": ".lime/runtime/audio/task-audio-1.mp3",
                        "mime_type": "audio/mpeg",
                        "duration_ms": 128000,
                        "source_text": "请为这段文案生成温暖旁白",
                        "voice": "warm_narrator",
                        "provider_id": "limecore",
                        "model": "voice-pro"
                    }
                },
                "status": "succeeded",
                "normalized_status": "succeeded",
                "created_at": "2026-04-30T10:00:00Z",
                "updated_at": "2026-04-30T10:00:05Z",
                "submitted_at": null,
                "started_at": "2026-04-30T10:00:01Z",
                "completed_at": "2026-04-30T10:00:05Z",
                "cancelled_at": null,
                "idempotency_key": null,
                "retry_count": 0,
                "source_task_id": null,
                "result": {
                    "kind": "audio_generation_result",
                    "status": "completed",
                    "audio_output": {
                        "kind": "audio_output",
                        "status": "completed",
                        "audio_path": ".lime/runtime/audio/task-audio-1.mp3",
                        "mime_type": "audio/mpeg",
                        "duration_ms": 128000,
                        "provider_id": "limecore",
                        "model": "voice-pro"
                    }
                },
                "last_error": null,
                "current_attempt_id": "attempt-audio-1",
                "current_attempt_worker_id": "lime-audio-worker",
                "attempts": [],
                "relationships": {},
                "progress": {},
                "ui_hints": {}
            }))
            .expect("serialize audio task"),
        )
        .expect("write audio task");
    }

    fn write_transcription_task_fixture(root: &Path, relative_path: &str) {
        let absolute_path = root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
        fs::create_dir_all(
            absolute_path
                .parent()
                .expect("transcription task path should have parent"),
        )
        .expect("create transcription task dir");
        fs::write(
            absolute_path,
            serde_json::to_string_pretty(&json!({
                "task_id": "task-transcription-1",
                "task_type": "transcription_generate",
                "task_family": "document",
                "title": "会议转写",
                "summary": "会议音频转写任务",
                "payload": {
                    "prompt": "生成逐字稿",
                    "source_path": "/tmp/interview.wav",
                    "language": "zh-CN",
                    "output_format": "srt",
                    "speaker_labels": true,
                    "timestamps": true,
                    "provider_id": "limecore",
                    "model": "asr-pro",
                    "entry_source": "at_transcription_command",
                    "modality_contract_key": AUDIO_TRANSCRIPTION_CONTRACT_KEY,
                    "modality": "audio",
                    "required_capabilities": ["text_generation", "audio_transcription"],
                    "routing_slot": AUDIO_TRANSCRIPTION_ROUTING_SLOT,
                    "runtime_contract": {
                        "contract_key": AUDIO_TRANSCRIPTION_CONTRACT_KEY,
                        "modality": "audio",
                        "required_capabilities": ["text_generation", "audio_transcription"],
                        "routing_slot": AUDIO_TRANSCRIPTION_ROUTING_SLOT,
                        "executor_binding": {
                            "executor_kind": "skill",
                            "binding_key": "transcription_generate"
                        },
                        "truth_source": ["transcript_artifact", "runtime_timeline_event"]
                    },
                    "transcript": {
                        "kind": "transcript",
                        "status": "pending",
                        "source_path": "/tmp/interview.wav",
                        "language": "zh-CN",
                        "output_format": "srt",
                        "speaker_labels": true,
                        "timestamps": true,
                        "provider_id": "limecore",
                        "model": "asr-pro"
                    }
                },
                "status": "pending_submit",
                "normalized_status": "pending",
                "created_at": "2026-04-30T10:00:00Z",
                "updated_at": "2026-04-30T10:00:05Z",
                "submitted_at": null,
                "started_at": null,
                "completed_at": null,
                "cancelled_at": null,
                "idempotency_key": null,
                "retry_count": 0,
                "source_task_id": null,
                "result": null,
                "last_error": null,
                "current_attempt_id": "attempt-transcription-1",
                "current_attempt_worker_id": "lime-transcription-worker",
                "attempts": [],
                "relationships": {},
                "progress": {},
                "ui_hints": {}
            }))
            .expect("serialize transcription task"),
        )
        .expect("write transcription task");
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
        let mut thread_read = build_thread_read();
        if let Some(permission_state) = thread_read.permission_state.as_mut() {
            permission_state.confirmation_status = Some("resolved".to_string());
            permission_state.confirmation_request_id = Some("approval-resolved".to_string());
            permission_state.confirmation_source = Some("runtime_action_required".to_string());
        }
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
        assert!(runtime.contains("\"permissionState\""));
        assert!(runtime.contains("\"status\": \"requires_confirmation\""));
        assert!(runtime.contains("\"askProfileKeys\""));
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
        assert!(artifacts.contains("\"permissionState\""));
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
                .pointer("/modalityRuntimeContracts/snapshots/0/executionProfileKey")
                .and_then(Value::as_str),
            Some("image_generation_profile")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/executorAdapterKey")
                .and_then(Value::as_str),
            Some("skill:image_generate")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/executionProfileKeys/0")
                .and_then(Value::as_str),
            Some("image_generation_profile")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/executorAdapterKeys/0")
                .and_then(Value::as_str),
            Some("skill:image_generate")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/limecorePolicyRefs/0")
                .and_then(Value::as_str),
            Some("model_catalog")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/limecorePolicySnapshot/status")
                .and_then(Value::as_str),
            Some("local_defaults_evaluated")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/limecorePolicySnapshot/decision")
                .and_then(Value::as_str),
            Some("allow")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshots/0/limecorePolicySnapshot/decision_source"
                )
                .and_then(Value::as_str),
            Some("local_default_policy")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshots/0/limecorePolicySnapshot/decision_scope"
                )
                .and_then(Value::as_str),
            Some("local_defaults_only")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/decisionSource"
                )
                .and_then(Value::as_str),
            Some("local_default_policy")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/policyEvaluation/status"
                )
                .and_then(Value::as_str),
            Some("input_gap")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/policyEvaluation/decision_source"
                )
                .and_then(Value::as_str),
            Some("policy_input_evaluator")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/policyEvaluation/pending_refs/0"
                )
                .and_then(Value::as_str),
            Some("model_catalog")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/unresolvedRefs/0"
                )
                .and_then(Value::as_str),
            Some("model_catalog")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/missingInputs/0"
                )
                .and_then(Value::as_str),
            Some("model_catalog")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/policyInputs/0/ref_key"
                )
                .and_then(Value::as_str),
            Some("model_catalog")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/policyInputs/0/value_source"
                )
                .and_then(Value::as_str),
            Some("limecore_pending")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/pendingHitRefs/0"
                )
                .and_then(Value::as_str),
            Some("model_catalog")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/policyValueHitCount"
                )
                .and_then(Value::as_u64),
            Some(0)
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/policyValueHits"
                )
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/missingInputs/0"
                )
                .and_then(Value::as_str),
            Some("model_catalog")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/pendingHitRefs/0"
                )
                .and_then(Value::as_str),
            Some("model_catalog")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/policyValueHitCount"
                )
                .and_then(Value::as_u64),
            Some(0)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/limecorePolicyRefs/0")
                .and_then(Value::as_str),
            Some("model_catalog")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/snapshotCount"
                )
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/statusCounts/0/status")
                .and_then(Value::as_str),
            Some("local_defaults_evaluated")
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
                    "content_id": "content-browser-1",
                    "model_id": "gpt-5.2-browser",
                    "cost_state": {
                        "status": "estimated",
                        "estimatedCostClass": "low"
                    },
                    "limit_state": {
                        "status": "within_limit"
                    },
                    "limit_event": {
                        "eventKind": "quota_low"
                    },
                    "required_capabilities": [
                        "text_generation",
                        "browser_reasoning",
                        "browser_control_planning"
                    ],
                    "routing_slot": BROWSER_CONTROL_ROUTING_SLOT,
                    "runtime_contract": {
                        "contract_key": BROWSER_CONTROL_CONTRACT_KEY,
                        "routing_slot": BROWSER_CONTROL_ROUTING_SLOT,
                        "executor_binding": {
                            "executor_kind": "browser_action",
                            "binding_key": "lime_browser_mcp"
                        }
                    },
                    "entry_source": "at_browser_command",
                    "action": "navigate",
                    "selected_backend": "cdp_direct",
                    "attempt_count": 1,
                    "result": {
                        "success": true,
                        "action": "navigate",
                        "request_id": "browser-request-1",
                        "session_id": "browser-session-1",
                        "target_id": "target-1",
                        "data": {
                            "browser_session": {
                                "session_id": "browser-session-1",
                                "profile_key": "general_browser_assist",
                                "target_id": "target-1",
                                "target_title": "Example",
                                "target_url": "https://example.com/"
                            }
                        }
                    }
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
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/browserAction/artifactKind")
                .and_then(Value::as_str),
            Some("browser_session")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/browserAction/sessionId")
                .and_then(Value::as_str),
            Some("browser-session-1")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/threadId")
                .and_then(Value::as_str),
            Some("thread-1")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/turnId")
                .and_then(Value::as_str),
            Some("turn-1")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contentId")
                .and_then(Value::as_str),
            Some("content-browser-1")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/entryKey")
                .and_then(Value::as_str),
            Some("at_browser_command")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/modelId")
                .and_then(Value::as_str),
            Some("gpt-5.2-browser")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/executorKind")
                .and_then(Value::as_str),
            Some("browser_action")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/executorBindingKey")
                .and_then(Value::as_str),
            Some("lime_browser_mcp")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/costState")
                .and_then(Value::as_str),
            Some("estimated")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/limitState")
                .and_then(Value::as_str),
            Some("within_limit")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/estimatedCostClass")
                .and_then(Value::as_str),
            Some("low")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/limitEventKind")
                .and_then(Value::as_str),
            Some("quota_low")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/quotaLow")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/taskIndex/threadIds/0")
                .and_then(Value::as_str),
            Some("thread-1")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/taskIndex/contentIds/0")
                .and_then(Value::as_str),
            Some("content-browser-1")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/taskIndex/entryKeys/0")
                .and_then(Value::as_str),
            Some("at_browser_command")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/taskIndex/modelIds/0")
                .and_then(Value::as_str),
            Some("gpt-5.2-browser")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/taskIndex/executorKinds/0")
                .and_then(Value::as_str),
            Some("browser_action")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/taskIndex/costStates/0")
                .and_then(Value::as_str),
            Some("estimated")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/taskIndex/limitStates/0")
                .and_then(Value::as_str),
            Some("within_limit")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/taskIndex/quotaLowCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/browserActionIndex/actionCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/browserActionIndex/sessionCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/browserActionIndex/lastUrl")
                .and_then(Value::as_str),
            Some("https://example.com/")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/browserActionIndex/items/0/action"
                )
                .and_then(Value::as_str),
            Some("navigate")
        );
        assert_eq!(
            result
                .observability_summary
                .pointer("/modalityRuntimeContracts/snapshotIndex/taskIndex/threadIds/0")
                .and_then(Value::as_str),
            Some("thread-1")
        );
        assert_eq!(
            result
                .observability_summary
                .pointer("/modalityRuntimeContracts/snapshotIndex/browserActionIndex/actionCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            result
                .observability_summary
                .pointer("/modalityRuntimeContracts/snapshotIndex/browserActionIndex/lastUrl")
                .and_then(Value::as_str),
            Some("https://example.com/")
        );
    }

    #[test]
    fn should_index_browser_snapshot_observation_from_tool_metadata() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "browser-snapshot-tool-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 4,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:40Z".to_string(),
            completed_at: Some("2026-03-27T10:00:40Z".to_string()),
            updated_at: "2026-03-27T10:00:40Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "mcp__lime-browser__get_page_info".to_string(),
                arguments: Some(json!({})),
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
                        "routing_slot": BROWSER_CONTROL_ROUTING_SLOT,
                        "executor_binding": {
                            "executor_kind": "browser_action",
                            "binding_key": "lime_browser_mcp"
                        }
                    },
                    "entry_source": "at_browser_agent_command",
                    "action": "get_page_info",
                    "selected_backend": "lime_extension_bridge",
                    "result": {
                        "success": true,
                        "action": "get_page_info",
                        "request_id": "browser-request-2",
                        "data": {
                            "title": "Example",
                            "url": "https://example.com/",
                            "screenshot_path": ".lime/runtime/browser/browser-snapshot-1.png",
                            "browser_session": {
                                "session_id": "browser-session-1",
                                "profile_key": "general_browser_assist",
                                "target_id": "target-1",
                                "target_title": "Example",
                                "target_url": "https://example.com/"
                            }
                        }
                    }
                })),
            },
        });

        let result =
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
                .pointer("/modalityRuntimeContracts/snapshots/0/browserAction/artifactKind")
                .and_then(Value::as_str),
            Some("browser_snapshot")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/browserActionIndex/observationCount"
                )
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/browserActionIndex/screenshotCount"
                )
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/browserActionIndex/items/0/artifactKind")
                .and_then(Value::as_str),
            Some("browser_snapshot")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/browserActionIndex/items/0/backend"
                )
                .and_then(Value::as_str),
            Some("lime_extension_bridge")
        );
        assert_eq!(
            result
                .observability_summary
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/browserActionIndex/items/0/artifactKind"
                )
                .and_then(Value::as_str),
            Some("browser_snapshot")
        );
        assert_eq!(
            result
                .observability_summary
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/browserActionIndex/observationCount"
                )
                .and_then(Value::as_u64),
            Some(1)
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
                .pointer("/modalityRuntimeContracts/snapshots/0/audioOutput/status")
                .and_then(Value::as_str),
            Some("completed")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/audioOutput/audioPath")
                .and_then(Value::as_str),
            Some(".lime/runtime/audio/task-audio-1.mp3")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/audioOutput/workerId")
                .and_then(Value::as_str),
            Some("lime-audio-worker")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/audioOutputIndex/outputCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/audioOutputIndex/statusCounts/0/status"
                )
                .and_then(Value::as_str),
            Some("completed")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/executorBindingKey")
                .and_then(Value::as_str),
            Some("voice_runtime")
        );
    }

    #[test]
    fn should_export_audio_transcription_contract_snapshot_from_transcription_task_artifact() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();
        let transcription_task_relative_path =
            ".lime/tasks/transcription_generate/task-transcription-1.json";

        write_transcription_task_fixture(temp_dir.path(), transcription_task_relative_path);

        if let AgentThreadItemPayload::FileArtifact { path, metadata, .. } =
            &mut detail.items[1].payload
        {
            *path = transcription_task_relative_path.to_string();
            *metadata = Some(json!({
                "task_type": "transcription_generate"
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
            Some("transcription_task.modality_runtime_contract")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(AUDIO_TRANSCRIPTION_CONTRACT_KEY)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/taskType")
                .and_then(Value::as_str),
            Some("transcription_generate")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/expectedRoutingSlot")
                .and_then(Value::as_str),
            Some(AUDIO_TRANSCRIPTION_ROUTING_SLOT)
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("executor_invoked")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/transcript/status")
                .and_then(Value::as_str),
            Some("pending")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/transcript/sourcePath")
                .and_then(Value::as_str),
            Some("/tmp/interview.wav")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/transcriptIndex/transcriptCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/transcriptIndex/statusCounts/0/status"
                )
                .and_then(Value::as_str),
            Some("pending")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/executorBindingKey")
                .and_then(Value::as_str),
            Some("transcription_generate")
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
                            },
                            "execution_profile": {
                                "profile_key": "web_research_profile"
                            },
                            "executor_adapter": {
                                "adapter_key": "skill:research"
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
                .pointer("/modalityRuntimeContracts/snapshots/0/executionProfileKey")
                .and_then(Value::as_str),
            Some("web_research_profile")
        );
        assert_eq!(
            runtime
                .pointer("/modalityRuntimeContracts/snapshots/0/executorAdapterKey")
                .and_then(Value::as_str),
            Some("skill:research")
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
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/executionProfileKey",
                )
                .and_then(Value::as_str),
            Some("web_research_profile")
        );
        assert_eq!(
            runtime
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/executorAdapterKey",
                )
                .and_then(Value::as_str),
            Some("skill:research")
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
