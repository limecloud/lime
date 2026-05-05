//! Runtime replay case 导出服务
//!
//! 目标是把当前 Lime 会话沉淀为最小可复盘、可评分、可回归的 replay case。
//! 这条主链参考 Codex 的 replay fidelity 与 Aster 的 eval / bench 组织方式，
//! 但最终制品仍然落在 Lime 工作区，复用现有 handoff bundle 与 evidence pack。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use crate::commands::modality_runtime_contracts::{
    AUDIO_TRANSCRIPTION_CONTRACT_KEY, BROWSER_CONTROL_CONTRACT_KEY, PDF_EXTRACT_CONTRACT_KEY,
    TEXT_TRANSFORM_CONTRACT_KEY, VOICE_GENERATION_CONTRACT_KEY, WEB_RESEARCH_CONTRACT_KEY,
};
use crate::services::runtime_evidence_pack_service::{
    export_runtime_evidence_pack, RuntimeEvidencePackExportResult,
};
use crate::services::runtime_file_checkpoint_service::list_file_checkpoints;
use crate::services::runtime_handoff_artifact_service::{
    export_runtime_handoff_bundle, RuntimeHandoffBundleExportResult,
};
use chrono::Utc;
use lime_core::database::dao::agent_timeline::AgentThreadItemPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt::Write as _;
use std::fs;
use std::path::Path;

const SESSION_RELATIVE_ROOT: &str = ".lime/harness/sessions";
const REPLAY_DIR_NAME: &str = "replay";
const INPUT_FILE_NAME: &str = "input.json";
const EXPECTED_FILE_NAME: &str = "expected.json";
const GRADER_FILE_NAME: &str = "grader.md";
const EVIDENCE_LINKS_FILE_NAME: &str = "evidence-links.json";
const MAX_RECENT_ARTIFACTS: usize = 8;
const MAX_RECENT_TIMELINE_ITEMS: usize = 6;
const MAX_PENDING_REQUESTS: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeReplayArtifactKind {
    Input,
    Expected,
    Grader,
    EvidenceLinks,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReplayArtifact {
    pub kind: RuntimeReplayArtifactKind,
    pub title: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReplayCaseExportResult {
    pub session_id: String,
    pub thread_id: String,
    pub workspace_id: Option<String>,
    pub workspace_root: String,
    pub replay_relative_root: String,
    pub replay_absolute_root: String,
    pub handoff_bundle_relative_root: String,
    pub evidence_pack_relative_root: String,
    pub exported_at: String,
    pub thread_status: String,
    pub latest_turn_status: Option<String>,
    pub pending_request_count: usize,
    pub queued_turn_count: usize,
    pub linked_handoff_artifact_count: usize,
    pub linked_evidence_artifact_count: usize,
    pub recent_artifact_count: usize,
    pub artifacts: Vec<RuntimeReplayArtifact>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ReplayPendingRequestInput {
    request_id: String,
    request_type: String,
    title: Option<String>,
    action_type: Option<String>,
    prompt: Option<String>,
    tool_name: Option<String>,
    arguments: Option<Value>,
    questions: Option<Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ReplayTimelineItem {
    item_id: String,
    turn_id: String,
    payload_kind: String,
    status: String,
    summary: Option<String>,
    updated_at: String,
}

pub fn export_runtime_replay_case(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: &Path,
) -> Result<RuntimeReplayCaseExportResult, String> {
    let session_id = detail.id.trim();
    if session_id.is_empty() {
        return Err("session_id 不能为空，无法导出 replay case".to_string());
    }

    let thread_id = detail.thread_id.trim();
    if thread_id.is_empty() {
        return Err("thread_id 不能为空，无法导出 replay case".to_string());
    }

    let workspace_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let exported_at = Utc::now().to_rfc3339();
    let replay_relative_root = format!("{SESSION_RELATIVE_ROOT}/{session_id}/{REPLAY_DIR_NAME}");
    let replay_absolute_root =
        workspace_root.join(replay_relative_root.replace('/', std::path::MAIN_SEPARATOR_STR));

    let handoff_bundle =
        export_runtime_handoff_bundle(detail, thread_read, workspace_root.as_path())?;
    let evidence_pack =
        export_runtime_evidence_pack(detail, thread_read, workspace_root.as_path())?;

    fs::create_dir_all(&replay_absolute_root).map_err(|error| {
        format!(
            "创建 replay case 目录失败 {}: {error}",
            replay_absolute_root.display()
        )
    })?;

    let latest_turn_summary = collect_latest_turn_summary(detail);
    let latest_plan = collect_latest_plan(detail);
    let goal_summary = latest_turn_summary
        .clone()
        .or(latest_plan.clone())
        .or_else(|| {
            detail
                .turns
                .last()
                .and_then(|turn| normalize_optional_text(Some(turn.prompt_text.clone())))
        });
    let recent_artifacts = collect_recent_artifact_paths(detail);
    let file_checkpoints = list_file_checkpoints(detail);
    let pending_requests = collect_pending_request_inputs(detail, thread_read);
    let recent_timeline = collect_recent_timeline_items(detail);
    let evidence_runtime_payload = read_runtime_payload_from_evidence_pack(&evidence_pack)?;
    let observability_summary =
        extract_observability_summary_from_runtime_payload(&evidence_runtime_payload);
    let modality_runtime_contracts =
        extract_modality_runtime_contracts_from_runtime_payload(&evidence_runtime_payload);
    let success_criteria = build_success_criteria(
        detail,
        thread_read,
        goal_summary.as_deref(),
        &recent_artifacts,
        &pending_requests,
        &modality_runtime_contracts,
    );
    let blocking_checks =
        build_blocking_checks(thread_read, &pending_requests, &modality_runtime_contracts);
    let artifact_checks = build_artifact_checks(&recent_artifacts);
    let modality_contract_checks = build_modality_contract_checks(&modality_runtime_contracts);

    let artifacts = vec![
        write_replay_file(
            &replay_absolute_root,
            session_id,
            INPUT_FILE_NAME,
            RuntimeReplayArtifactKind::Input,
            "回放输入",
            build_input_json(
                detail,
                thread_read,
                &handoff_bundle,
                &evidence_pack,
                goal_summary.as_deref(),
                latest_plan.as_deref(),
                latest_turn_summary.as_deref(),
                &recent_artifacts,
                &file_checkpoints.checkpoints,
                &recent_timeline,
                &pending_requests,
                &observability_summary,
                &modality_runtime_contracts,
                workspace_root.as_path(),
                exported_at.as_str(),
            )?,
        )?,
        write_replay_file(
            &replay_absolute_root,
            session_id,
            EXPECTED_FILE_NAME,
            RuntimeReplayArtifactKind::Expected,
            "期望结果",
            build_expected_json(
                detail,
                thread_read,
                goal_summary.as_deref(),
                &success_criteria,
                &blocking_checks,
                &artifact_checks,
                &modality_contract_checks,
                &modality_runtime_contracts,
                exported_at.as_str(),
            )?,
        )?,
        write_replay_file(
            &replay_absolute_root,
            session_id,
            GRADER_FILE_NAME,
            RuntimeReplayArtifactKind::Grader,
            "评分说明",
            build_grader_markdown(
                detail,
                goal_summary.as_deref(),
                &success_criteria,
                &blocking_checks,
                &modality_contract_checks,
                handoff_bundle.bundle_relative_root.as_str(),
                evidence_pack.pack_relative_root.as_str(),
                exported_at.as_str(),
            ),
        )?,
        write_replay_file(
            &replay_absolute_root,
            session_id,
            EVIDENCE_LINKS_FILE_NAME,
            RuntimeReplayArtifactKind::EvidenceLinks,
            "证据链接",
            build_evidence_links_json(
                &handoff_bundle,
                &evidence_pack,
                &recent_artifacts,
                &observability_summary,
                &modality_runtime_contracts,
                exported_at.as_str(),
            )?,
        )?,
    ];

    Ok(RuntimeReplayCaseExportResult {
        session_id: session_id.to_string(),
        thread_id: thread_id.to_string(),
        workspace_id: normalize_optional_text(detail.workspace_id.clone()),
        workspace_root: workspace_root.to_string_lossy().to_string(),
        replay_relative_root,
        replay_absolute_root: replay_absolute_root.to_string_lossy().to_string(),
        handoff_bundle_relative_root: handoff_bundle.bundle_relative_root,
        evidence_pack_relative_root: evidence_pack.pack_relative_root,
        exported_at,
        thread_status: thread_read.status.trim().to_string(),
        latest_turn_status: thread_read
            .diagnostics
            .as_ref()
            .and_then(|value| normalize_optional_text(value.latest_turn_status.clone())),
        pending_request_count: thread_read.pending_requests.len(),
        queued_turn_count: thread_read.queued_turns.len(),
        linked_handoff_artifact_count: handoff_bundle.artifacts.len(),
        linked_evidence_artifact_count: evidence_pack.artifacts.len(),
        recent_artifact_count: recent_artifacts.len(),
        artifacts,
    })
}

fn write_replay_file(
    replay_root: &Path,
    session_id: &str,
    file_name: &str,
    kind: RuntimeReplayArtifactKind,
    title: &str,
    content: String,
) -> Result<RuntimeReplayArtifact, String> {
    let absolute_path = replay_root.join(file_name);
    fs::write(&absolute_path, content.as_bytes()).map_err(|error| {
        format!(
            "写入 replay case 文件失败 {}: {error}",
            absolute_path.display()
        )
    })?;

    Ok(RuntimeReplayArtifact {
        kind,
        title: title.to_string(),
        relative_path: format!(
            "{SESSION_RELATIVE_ROOT}/{session_id}/{REPLAY_DIR_NAME}/{file_name}"
        ),
        absolute_path: absolute_path.to_string_lossy().to_string(),
        bytes: content.len(),
    })
}

fn read_runtime_payload_from_evidence_pack(
    evidence_pack: &RuntimeEvidencePackExportResult,
) -> Result<Value, String> {
    let runtime_path = Path::new(&evidence_pack.pack_absolute_root).join("runtime.json");
    let raw = fs::read_to_string(&runtime_path).map_err(|error| {
        format!(
            "读取 evidence pack runtime.json 失败 {}: {error}",
            runtime_path.display()
        )
    })?;
    let payload = serde_json::from_str::<Value>(raw.as_str()).map_err(|error| {
        format!(
            "解析 evidence pack runtime.json 失败 {}: {error}",
            runtime_path.display()
        )
    })?;

    Ok(payload)
}

fn extract_observability_summary_from_runtime_payload(payload: &Value) -> Value {
    payload
        .pointer("/observabilitySummary")
        .cloned()
        .unwrap_or(Value::Null)
}

fn extract_modality_runtime_contracts_from_runtime_payload(payload: &Value) -> Value {
    payload
        .pointer("/modalityRuntimeContracts")
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "applicableArtifactCount": 0,
                "snapshotCount": 0,
                "snapshots": []
            })
        })
}

#[allow(clippy::too_many_arguments)]
fn build_input_json(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    handoff_bundle: &RuntimeHandoffBundleExportResult,
    evidence_pack: &RuntimeEvidencePackExportResult,
    goal_summary: Option<&str>,
    latest_plan: Option<&str>,
    latest_turn_summary: Option<&str>,
    recent_artifacts: &[String],
    file_checkpoints: &[crate::commands::aster_agent_cmd::AgentRuntimeFileCheckpointSummary],
    recent_timeline: &[ReplayTimelineItem],
    pending_requests: &[ReplayPendingRequestInput],
    observability_summary: &Value,
    modality_runtime_contracts: &Value,
    workspace_root: &Path,
    exported_at: &str,
) -> Result<String, String> {
    let latest_turn = detail.turns.last();
    let suite_tags = infer_replay_suite_tags(
        detail,
        thread_read,
        handoff_bundle,
        evidence_pack,
        modality_runtime_contracts,
    );
    let failure_modes = infer_replay_failure_modes(detail, thread_read, modality_runtime_contracts);
    let primary_blocking_kind = thread_read
        .diagnostics
        .as_ref()
        .and_then(|value| normalize_optional_text(value.primary_blocking_kind.clone()));
    let payload = json!({
        "replayCaseVersion": "v1",
        "source": "lime.runtime_export.replay_case",
        "exportedAt": exported_at,
        "session": {
            "sessionId": detail.id.as_str(),
            "threadId": detail.thread_id.as_str(),
            "workspaceId": detail.workspace_id.clone(),
            "workspaceRoot": workspace_root.to_string_lossy().to_string(),
            "model": detail.model.clone(),
            "executionStrategy": detail.execution_strategy.clone(),
        },
        "task": {
            "goalSummary": goal_summary,
            "latestPlan": latest_plan,
            "latestTurnSummary": latest_turn_summary,
            "latestTurnPrompt": latest_turn.map(|turn| turn.prompt_text.clone()),
            "latestTurnId": latest_turn.map(|turn| turn.id.clone()),
            "latestTurnStatus": latest_turn.map(|turn| turn.status.as_str().to_string()),
            "threadStatus": thread_read.status.as_str(),
            "primaryBlockingSummary": thread_read
                .diagnostics
                .as_ref()
                .and_then(|value| value.primary_blocking_summary.clone()),
        },
        "classification": {
            "sourceKind": "runtime_export",
            "suiteTags": suite_tags,
            "failureModes": failure_modes,
            "primaryBlockingKind": primary_blocking_kind,
            "modalityContractKeys": modality_contract_keys(modality_runtime_contracts),
        },
        "runtimeContext": {
            "pendingRequests": pending_requests,
            "queuedTurns": thread_read.queued_turns.iter().map(|turn| {
                json!({
                    "queuedTurnId": turn.queued_turn_id,
                    "messagePreview": turn.message_preview,
                    "position": turn.position,
                })
            }).collect::<Vec<_>>(),
            "todoItems": detail.todo_items.iter().map(|item| {
                json!({
                    "content": item.content.as_str(),
                    "status": session_todo_status_label(item),
                })
            }).collect::<Vec<_>>(),
            "activeSubagents": detail.child_subagent_sessions.iter().map(|session| {
                json!({
                    "id": session.id.as_str(),
                    "name": session.name.as_str(),
                    "roleHint": session.role_hint.clone(),
                    "taskSummary": session.task_summary.clone(),
                    "runtimeStatus": session
                        .runtime_status
                        .as_ref()
                        .map(child_subagent_runtime_status_label),
                })
            }).collect::<Vec<_>>(),
            "recentArtifacts": recent_artifacts,
            "fileCheckpointCount": file_checkpoints.len(),
            "fileCheckpoints": file_checkpoints,
            "recentTimeline": recent_timeline,
            "lastOutcome": &thread_read.last_outcome,
            "incidents": &thread_read.incidents,
            "runtimeFacts": build_replay_runtime_facts(thread_read, modality_runtime_contracts),
            "modalityRuntimeContracts": modality_runtime_contracts,
        },
        "observability": observability_summary,
        "linkedArtifacts": {
            "handoffBundle": {
                "relativeRoot": handoff_bundle.bundle_relative_root.as_str(),
                "artifactCount": handoff_bundle.artifacts.len(),
            },
            "evidencePack": {
                "relativeRoot": evidence_pack.pack_relative_root.as_str(),
                "artifactCount": evidence_pack.artifacts.len(),
                "knownGaps": &evidence_pack.known_gaps,
            },
        },
    });

    serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 input.json 失败: {error}"))
}

fn build_expected_json(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    goal_summary: Option<&str>,
    success_criteria: &[String],
    blocking_checks: &[String],
    artifact_checks: &[String],
    modality_contract_checks: &[String],
    modality_runtime_contracts: &Value,
    exported_at: &str,
) -> Result<String, String> {
    let payload = json!({
        "replayCaseVersion": "v1",
        "exportedAt": exported_at,
        "sessionId": detail.id.as_str(),
        "threadId": detail.thread_id.as_str(),
        "goalSummary": goal_summary,
        "successCriteria": success_criteria,
        "blockingChecks": blocking_checks,
        "artifactChecks": artifact_checks,
        "modalityContractChecks": modality_contract_checks,
        "nonGoals": [
            "不要要求与原始会话完全相同的工具调用顺序",
            "不要把措辞差异当作失败，除非它改变了交付结果或风险判断",
        ],
        "graderSuggestion": {
            "preferredMode": if pending_request_like_state(thread_read) {
                "result_artifact_and_request_resolution"
            } else {
                "result_and_artifact"
            },
            "requiresHumanReview": !thread_read.incidents.is_empty()
                || modality_contract_has_routing_block(modality_runtime_contracts),
        },
    });

    serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 expected.json 失败: {error}"))
}

fn build_grader_markdown(
    detail: &SessionDetail,
    goal_summary: Option<&str>,
    success_criteria: &[String],
    blocking_checks: &[String],
    modality_contract_checks: &[String],
    handoff_relative_root: &str,
    evidence_relative_root: &str,
    exported_at: &str,
) -> String {
    let mut markdown = String::new();
    let _ = writeln!(markdown, "# Replay Case 评分说明");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 会话：`{}`", detail.id);
    let _ = writeln!(markdown, "- 线程：`{}`", detail.thread_id);
    let _ = writeln!(markdown, "- 导出时间：{exported_at}");
    if let Some(summary) = goal_summary {
        let _ = writeln!(markdown, "- 目标摘要：{summary}");
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 建议读取顺序");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "1. 先读 `input.json`，理解当前任务与运行时上下文。"
    );
    let _ = writeln!(markdown, "2. 再读 `expected.json`，确认只评估结果与风险。");
    let _ = writeln!(
        markdown,
        "3. 再读 `evidence-links.json`，跳转到已有证据源。"
    );
    let _ = writeln!(
        markdown,
        "4. 如需补证据，优先回看 `{handoff_relative_root}` 与 `{evidence_relative_root}`。"
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 评分原则");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 只评结果，不评路径。");
    let _ = writeln!(markdown, "- 先证据后结论；没有证据支撑的 PASS 不成立。");
    let _ = writeln!(
        markdown,
        "- 如仍存在 pending request，必须解释它是已处理、仍保留，还是不影响判定。"
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 最小通过条件");
    let _ = writeln!(markdown);
    for criterion in success_criteria {
        let _ = writeln!(markdown, "- {criterion}");
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 关键阻塞检查");
    let _ = writeln!(markdown);
    for check in blocking_checks {
        let _ = writeln!(markdown, "- {check}");
    }
    if !modality_contract_checks.is_empty() {
        let _ = writeln!(markdown);
        let _ = writeln!(markdown, "## 多模态运行合同检查");
        let _ = writeln!(markdown);
        for check in modality_contract_checks {
            let _ = writeln!(markdown, "- {check}");
        }
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 建议输出模板");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "```text");
    let _ = writeln!(markdown, "verdict: pass | fail | needs_review");
    let _ = writeln!(markdown, "reason:");
    let _ = writeln!(markdown, "- ...");
    let _ = writeln!(markdown, "evidence:");
    let _ = writeln!(markdown, "- ...");
    let _ = writeln!(markdown, "risks:");
    let _ = writeln!(markdown, "- ...");
    let _ = writeln!(markdown, "```");

    markdown
}

fn build_evidence_links_json(
    handoff_bundle: &RuntimeHandoffBundleExportResult,
    evidence_pack: &RuntimeEvidencePackExportResult,
    recent_artifacts: &[String],
    observability_summary: &Value,
    modality_runtime_contracts: &Value,
    exported_at: &str,
) -> Result<String, String> {
    let payload = json!({
        "replayCaseVersion": "v1",
        "exportedAt": exported_at,
        "handoffBundle": {
            "relativeRoot": handoff_bundle.bundle_relative_root.as_str(),
            "absoluteRoot": handoff_bundle.bundle_absolute_root.as_str(),
            "artifacts": &handoff_bundle.artifacts,
        },
        "evidencePack": {
            "relativeRoot": evidence_pack.pack_relative_root.as_str(),
            "absoluteRoot": evidence_pack.pack_absolute_root.as_str(),
            "knownGaps": &evidence_pack.known_gaps,
            "artifacts": &evidence_pack.artifacts,
        },
        "observabilitySummary": observability_summary,
        "modalityRuntimeContracts": modality_runtime_contracts,
        "recentArtifacts": recent_artifacts,
    });

    serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 evidence-links.json 失败: {error}"))
}

fn build_replay_runtime_facts(
    thread_read: &AgentRuntimeThreadReadModel,
    modality_runtime_contracts: &Value,
) -> Value {
    json!({
        "taskKind": thread_read.task_kind,
        "serviceModelSlot": thread_read.service_model_slot,
        "routingMode": thread_read.routing_mode,
        "decisionSource": thread_read.decision_source,
        "candidateCount": thread_read.candidate_count,
        "capabilityGap": thread_read.capability_gap,
        "decisionReason": thread_read.decision_reason,
        "fallbackChain": thread_read.fallback_chain,
        "estimatedCostClass": thread_read.estimated_cost_class,
        "limitState": thread_read.limit_state,
        "costState": thread_read.cost_state,
        "limitEvent": thread_read.limit_event,
        "runtimeSummary": thread_read.runtime_summary,
        "permissionState": thread_read.permission_state,
        "oemPolicy": thread_read.oem_policy,
        "auxiliaryTaskRuntime": thread_read.auxiliary_task_runtime,
        "modalityTaskIndex": build_replay_modality_task_index_facts(modality_runtime_contracts)
    })
}

fn build_replay_modality_task_index_facts(modality_runtime_contracts: &Value) -> Value {
    if let Some(index) = modality_contract_task_index(modality_runtime_contracts) {
        json!({
            "snapshotCount": modality_contract_task_index_snapshot_count(modality_runtime_contracts),
            "threadIds": modality_contract_task_index_strings(index, "threadIds", "thread_ids", "threadId", "thread_id"),
            "turnIds": modality_contract_task_index_strings(index, "turnIds", "turn_ids", "turnId", "turn_id"),
            "contentIds": modality_contract_task_index_strings(index, "contentIds", "content_ids", "contentId", "content_id"),
            "entryKeys": modality_contract_task_index_strings(index, "entryKeys", "entry_keys", "entryKey", "entry_key"),
            "modalities": modality_contract_task_index_strings(index, "modalities", "modalities", "modality", "modality"),
            "skillIds": modality_contract_task_index_strings(index, "skillIds", "skill_ids", "skillId", "skill_id"),
            "modelIds": modality_contract_task_index_strings(index, "modelIds", "model_ids", "modelId", "model_id"),
            "executorKinds": modality_contract_task_index_strings(index, "executorKinds", "executor_kinds", "executorKind", "executor_kind"),
            "executorBindingKeys": modality_contract_task_index_strings(index, "executorBindingKeys", "executor_binding_keys", "executorBindingKey", "executor_binding_key"),
            "costStates": modality_contract_task_index_strings(index, "costStates", "cost_states", "costState", "cost_state"),
            "limitStates": modality_contract_task_index_strings(index, "limitStates", "limit_states", "limitState", "limit_state"),
            "estimatedCostClasses": modality_contract_task_index_strings(index, "estimatedCostClasses", "estimated_cost_classes", "estimatedCostClass", "estimated_cost_class"),
            "limitEventKinds": modality_contract_task_index_strings(index, "limitEventKinds", "limit_event_kinds", "limitEventKind", "limit_event_kind"),
            "quotaLowCount": modality_contract_task_index_quota_low_count(index),
            "itemCount": modality_contract_task_index_item_count(index)
        })
    } else {
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
            "itemCount": 0
        })
    }
}

fn build_success_criteria(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    goal_summary: Option<&str>,
    recent_artifacts: &[String],
    pending_requests: &[ReplayPendingRequestInput],
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let mut criteria = Vec::new();

    if let Some(summary) = goal_summary {
        criteria.push(format!("结果应延续当前目标：{summary}"));
    }

    let unfinished_todos = detail
        .todo_items
        .iter()
        .filter(|item| !session_todo_completed(item))
        .map(|item| item.content.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if !unfinished_todos.is_empty() {
        criteria.push(format!(
            "结果应至少推动这些未完成项：{}",
            unfinished_todos.join("；")
        ));
    }

    if !pending_requests.is_empty() {
        criteria.push(
            "如果样本仍包含待处理请求，评分时必须确认这些请求是否已被正确处理或明确保留。"
                .to_string(),
        );
    }

    if normalize_optional_text(thread_read.decision_reason.clone()).is_some() {
        criteria
            .push("结果应与当前 runtime 决策解释保持一致，除非样本明确要求切换路径。".to_string());
    }

    if !recent_artifacts.is_empty() {
        criteria.push(format!(
            "如果任务继续沿用已有产物，应优先验证这些文件没有偏离：{}",
            recent_artifacts
                .iter()
                .take(3)
                .map(|path| format!("`{path}`"))
                .collect::<Vec<_>>()
                .join("、")
        ));
    }

    if !thread_read.queued_turns.is_empty() {
        criteria.push("不要无意吞掉排队 turn；如要清空或改写，必须有明确理由。".to_string());
    }

    if modality_contract_snapshot_count(modality_runtime_contracts) > 0 {
        criteria.push(format!(
            "回放必须继续满足底层多模态运行合同：{}。",
            format_text_list(
                &modality_contract_keys(modality_runtime_contracts),
                "未命名合同"
            )
        ));
        let execution_profile_keys =
            modality_contract_execution_profile_keys(modality_runtime_contracts);
        if !execution_profile_keys.is_empty() {
            criteria.push(format!(
                "回放必须保留 execution profile 决策输入：{}。",
                format_text_list(&execution_profile_keys, "未记录 execution profile")
            ));
        }
        let executor_adapter_keys =
            modality_contract_executor_adapter_keys(modality_runtime_contracts);
        if !executor_adapter_keys.is_empty() {
            criteria.push(format!(
                "回放必须保留 executor adapter 绑定：{}，不能退回自由工具选择或旧 CLI 旁路。",
                format_text_list(&executor_adapter_keys, "未记录 executor adapter")
            ));
        }
        if modality_contract_has_task_index(modality_runtime_contracts) {
            criteria.push(format!(
                "回放必须保留 Evidence `snapshotIndex.taskIndex`，继续暴露身份锚点 thread/turn/content/entry：{}。",
                format_text_list(
                    &modality_contract_task_index_identity_anchors(modality_runtime_contracts),
                    "未记录 task index identity"
                )
            ));
            let executor_dimensions =
                modality_contract_task_index_executor_dimensions(modality_runtime_contracts);
            if !executor_dimensions.is_empty() {
                criteria.push(format!(
                    "回放必须保留 task index executor 维度：{}，不能退回无绑定的自由工具选择。",
                    format_text_list(&executor_dimensions, "未记录 executor 维度")
                ));
            }
            let cost_limit_dimensions =
                modality_contract_task_index_cost_limit_dimensions(modality_runtime_contracts);
            if !cost_limit_dimensions.is_empty() {
                criteria.push(format!(
                    "回放必须保留 task index cost/limit 摘要：{}；除非有真实 runtime 摘要更新，否则不能伪造成本或限额状态。",
                    format_text_list(&cost_limit_dimensions, "未记录 cost/limit 摘要")
                ));
            }
        }
        let limecore_policy_refs =
            modality_contract_limecore_policy_refs(modality_runtime_contracts);
        if modality_contract_has_limecore_policy_index(modality_runtime_contracts) {
            criteria.push(format!(
                "回放必须保留 `snapshotIndex.limecorePolicyIndex`，继续暴露 LimeCore policy refs：{}。",
                format_text_list(&limecore_policy_refs, "未记录 LimeCore policy refs")
            ));
        }
        let limecore_missing_inputs =
            modality_contract_limecore_policy_missing_inputs(modality_runtime_contracts);
        if !limecore_missing_inputs.is_empty() {
            criteria.push(format!(
                "回放必须保留 LimeCore missing inputs：{}；除非 replay 写回真实命中值，否则不能把本地默认 allow 当作 tenant/provider/gateway 真实放行。",
                format_text_list(&limecore_missing_inputs, "未记录 missing inputs")
            ));
        }
    }
    if modality_contract_has_browser_control(modality_runtime_contracts) {
        criteria.push(
            "浏览器控制任务必须继续走 Browser Assist / `mcp__lime-browser__*` 主链，不能用 WebSearch 或普通聊天替代真实浏览器动作。"
                .to_string(),
        );
        criteria.push(
            "Browser Assist 证据必须能在 `snapshotIndex.browserActionIndex` 中定位 action、session、URL 或 observation 摘要，不能只靠人工扫描 raw snapshots。"
                .to_string(),
        );
    }
    if modality_contract_has_pdf_extract(modality_runtime_contracts) {
        criteria.push(
            "PDF 读取任务必须继续走 `Skill(pdf_read)` 或真实 `list_directory` / `read_file` 证据链，不能用 `frontend_direct_pdf_parse`、`generic_chat_summary_only`、WebSearch 或普通聊天替代真实读 PDF。"
                .to_string(),
        );
    }
    if modality_contract_has_voice_generation(modality_runtime_contracts) {
        criteria.push(
            "配音任务必须继续走 `service_scene_launch(scene_key=voice_runtime)` / 本地 ServiceSkill runtime 主链，不能用 `legacy_tts_test_command`、伪造云端已提交、普通聊天文本或通用文件卡替代真实语音生成合同。"
                .to_string(),
        );
        if modality_contract_has_voice_audio_output_completed(modality_runtime_contracts) {
            criteria.push(
                "如果 replay 沿用已有音频任务，必须保留 `audio_output.completed` 与真实 `audio_path`，不能退回只展示文案或通用文件卡。"
                    .to_string(),
            );
        }
    }
    if modality_contract_has_audio_transcription(modality_runtime_contracts) {
        criteria.push(
            "转写任务必须继续走 `Skill(transcription_generate)` / `transcription_generate` task file 主链，不能用 `frontend_direct_asr`、`generic_file_transcript`、普通文件读取或普通聊天伪造 transcript。"
                .to_string(),
        );
        criteria.push(
            "转写证据必须能在 `snapshotIndex.transcriptIndex` 中定位 transcript 状态、来源、语言或输出格式，不能只靠人工扫描 raw task JSON。"
                .to_string(),
        );
        if modality_contract_has_transcript_completed(modality_runtime_contracts) {
            criteria.push(
                "如果 replay 沿用已有转写结果，必须保留 `transcript.completed` 与真实 `transcriptPath`，不能退回只展示 Markdown 文本。"
                    .to_string(),
            );
        }
    }
    if modality_contract_has_web_research(modality_runtime_contracts) {
        criteria.push(
            "联网研究任务必须继续走 `Skill(research)` / `Skill(site_search)` / `Skill(report_generate)` 与真实 search_query / lime_site_* 工具时间线，不能用模型记忆、本地文件搜索或普通聊天替代真实联网研究。"
                .to_string(),
        );
    }
    if modality_contract_has_text_transform(modality_runtime_contracts) {
        criteria.push(
            "文本/文档转换任务必须继续走 `Skill(summary)` / `Skill(translation)` / `Skill(analysis)`，显式文件路径场景可保留 `list_directory` / `read_file` 证据，不能用 `frontend_direct_text_transform`、ToolSearch、WebSearch 或普通聊天替代底层合同。"
                .to_string(),
        );
    }

    if criteria.is_empty() {
        criteria.push("结果应与 input.json 描述的任务目标一致。".to_string());
    }

    criteria
}

fn build_blocking_checks(
    thread_read: &AgentRuntimeThreadReadModel,
    pending_requests: &[ReplayPendingRequestInput],
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let mut checks = Vec::new();

    if let Some(summary) = thread_read
        .diagnostics
        .as_ref()
        .and_then(|value| normalize_optional_text(value.primary_blocking_summary.clone()))
    {
        checks.push(format!("当前主要阻塞：{summary}"));
    }

    for request in pending_requests {
        checks.push(format!(
            "待处理请求 `{}`：{}",
            request.request_id,
            request
                .title
                .clone()
                .or_else(|| request.prompt.clone())
                .unwrap_or_else(|| "需要确认该请求是否已解决".to_string())
        ));
    }

    if !thread_read.queued_turns.is_empty() {
        checks.push(format!(
            "当前仍有 {} 条排队 turn，需确认 replay 评估是否把它们误判成已完成。",
            thread_read.queued_turns.len()
        ));
    }

    if let Some(permission_state) = thread_read.permission_state.as_ref() {
        let confirmation_status = permission_state.confirmation_status.as_deref();
        if confirmation_status == Some("denied") {
            checks.push(format!(
                "运行时权限确认已被拒绝：{}；除非 replay 改写任务目标或重新获得真实授权，否则不能判 PASS。",
                permission_state
                    .confirmation_request_id
                    .as_deref()
                    .unwrap_or("未记录 confirmationRequestId")
            ));
        } else if permission_state.status == "requires_confirmation"
            && confirmation_status != Some("resolved")
        {
            checks.push(format!(
                "运行时权限声明仍需确认：{}；除非 replay 已接入真实授权或用户确认证据，否则不能宣称这些权限已获批。",
                format_text_list(&permission_state.ask_profile_keys, "未记录 askProfileKeys")
            ));
        }
        if !permission_state.blocking_profile_keys.is_empty() {
            checks.push(format!(
                "运行时权限声明包含阻断项：{}；除非 replay 改写权限策略或移除对应执行需求，否则不能判 PASS。",
                format_text_list(
                    &permission_state.blocking_profile_keys,
                    "未记录 blockingProfileKeys"
                )
            ));
        }
    }

    if let Some(limit_state) = thread_read.limit_state.as_ref() {
        if limit_state.status == "user_locked_capability_gap" {
            let capability_gap = limit_state
                .capability_gap
                .as_deref()
                .or(thread_read.capability_gap.as_deref())
                .unwrap_or("未记录 capabilityGap");
            checks.push(format!(
                "显式用户模型锁定不满足当前 execution profile：{capability_gap}；除非 replay 切换到满足 routingSlot 的模型或取消显式模型锁定，否则不能判 PASS。"
            ));
        }
    }

    if modality_contract_has_routing_block(modality_runtime_contracts) {
        checks.push(format!(
            "多模态运行合同存在路由阻塞：{}；除非重放已换到满足合同的模型并成功产出，否则不能判 PASS。",
            format_text_list(
                &modality_contract_failure_codes(modality_runtime_contracts),
                "未记录 failureCode"
            )
        ));
    }
    if modality_contract_snapshot_count(modality_runtime_contracts) > 0
        && !modality_contract_has_task_index(modality_runtime_contracts)
    {
        checks.push(
            "多模态运行合同缺少 Evidence `snapshotIndex.taskIndex`；除非 replay 重新导出同一 task index，否则不能证明身份锚点、executor 与 cost/limit 摘要仍可查询。"
                .to_string(),
        );
    }
    if modality_contract_has_browser_control(modality_runtime_contracts)
        && !modality_contract_has_browser_action_trace(modality_runtime_contracts)
    {
        checks.push(
            "`browser_control` 合同缺少 browser action trace；除非 replay 重新产生 Browser Assist 工具调用证据，否则不能判 PASS。"
                .to_string(),
        );
    }
    if modality_contract_has_browser_control(modality_runtime_contracts)
        && !modality_contract_has_browser_action_index(modality_runtime_contracts)
    {
        checks.push(
            "`browser_control` 合同缺少 `snapshotIndex.browserActionIndex`；除非 replay 重新导出可查询的 browser session/snapshot 索引，否则不能判 PASS。"
                .to_string(),
        );
    }
    if modality_contract_has_pdf_extract(modality_runtime_contracts)
        && !modality_contract_has_pdf_skill_trace(modality_runtime_contracts)
    {
        checks.push(
            "`pdf_extract` 合同缺少 Skill(pdf_read) / 文件读取 trace；除非 replay 重新产生 Skill(pdf_read)、list_directory 或 read_file 证据，否则不能判 PASS。"
                .to_string(),
        );
    }
    if modality_contract_has_voice_generation(modality_runtime_contracts)
        && !modality_contract_has_voice_generation_service_trace(modality_runtime_contracts)
    {
        checks.push(
            "`voice_generation` 合同缺少 voice_runtime service scene trace；除非 replay 重新产生 service_scene_launch(scene_key=voice_runtime) 或 audio_task/audio_output 证据，否则不能判 PASS。"
                .to_string(),
        );
    }
    if modality_contract_has_voice_audio_output_failed(modality_runtime_contracts) {
        checks.push(format!(
            "`voice_generation` 的 audio_output 已失败：{}；除非 replay 修复 provider / model / API Key 并产出新的 audio_output.completed，否则不能判 PASS。",
            format_text_list(
                &modality_contract_voice_audio_output_error_codes(modality_runtime_contracts),
                "未记录 audio_output errorCode"
            )
        ));
    }
    if modality_contract_has_audio_transcription(modality_runtime_contracts)
        && !modality_contract_has_audio_transcription_task_trace(modality_runtime_contracts)
    {
        checks.push(
            "`audio_transcription` 合同缺少 transcription_generate task/Skill trace；除非 replay 重新产生 Skill(transcription_generate) 或 transcription task artifact 证据，否则不能判 PASS。"
                .to_string(),
        );
    }
    if modality_contract_has_audio_transcription(modality_runtime_contracts)
        && !modality_contract_has_transcript_index(modality_runtime_contracts)
    {
        checks.push(
            "`audio_transcription` 合同缺少 `snapshotIndex.transcriptIndex`；除非 replay 重新导出可查询的 transcript 索引，否则不能判 PASS。"
                .to_string(),
        );
    }
    if modality_contract_has_transcript_failed(modality_runtime_contracts) {
        checks.push(format!(
            "`audio_transcription` 的 transcript 已失败：{}；除非 replay 修复 provider / model / 输入源并产出新的 transcript.completed，否则不能判 PASS。",
            format_text_list(
                &modality_contract_transcript_error_codes(modality_runtime_contracts),
                "未记录 transcript errorCode"
            )
        ));
    }
    if modality_contract_has_web_research(modality_runtime_contracts)
        && !modality_contract_has_web_research_skill_trace(modality_runtime_contracts)
    {
        checks.push(
            "`web_research` 合同缺少 Skill(research) / Skill(site_search) / Skill(report_generate) trace；除非 replay 重新产生 Skill 调用与 search_query 或 lime_site_* 证据，否则不能判 PASS。"
                .to_string(),
        );
    }
    if modality_contract_has_text_transform(modality_runtime_contracts)
        && !modality_contract_has_text_transform_skill_trace(modality_runtime_contracts)
    {
        checks.push(
            "`text_transform` 合同缺少 Skill(summary) / Skill(translation) / Skill(analysis) trace；除非 replay 重新产生文本转换 Skill 调用，必要时保留 list_directory / read_file 证据，否则不能判 PASS。"
                .to_string(),
        );
    }
    let limecore_missing_inputs =
        modality_contract_limecore_policy_missing_inputs(modality_runtime_contracts);
    if !limecore_missing_inputs.is_empty() {
        checks.push(format!(
            "`limecorePolicyIndex` 仍有 missing inputs：{}；除非 replay 写回真实 `model_catalog / provider_offer / tenant_feature_flags / gateway_policy` 命中值，否则不能宣称真实 LimeCore policy 已放行。",
            format_text_list(&limecore_missing_inputs, "未记录 missing inputs")
        ));
    }

    if checks.is_empty() {
        checks.push("当前没有额外阻塞检查项，按结果与证据判定即可。".to_string());
    }

    checks
}

fn build_modality_contract_checks(modality_runtime_contracts: &Value) -> Vec<String> {
    if modality_contract_snapshot_count(modality_runtime_contracts) == 0 {
        return Vec::new();
    }

    let mut checks = vec![format!(
        "确认 replay 沿用的 contract key 仍是：{}。",
        format_text_list(
            &modality_contract_keys(modality_runtime_contracts),
            "未命名合同"
        )
    )];

    let models = modality_contract_models(modality_runtime_contracts);
    if !models.is_empty() {
        checks.push(format!(
            "确认模型路由与合同匹配；当前快照模型：{}。",
            format_text_list(&models, "未记录模型")
        ));
    }
    let assessment_sources =
        modality_contract_model_capability_assessment_sources(modality_runtime_contracts);
    if !assessment_sources.is_empty() {
        checks.push(format!(
            "确认模型能力判定继续来自登记事实源：{}。",
            format_text_list(&assessment_sources, "未记录判定来源")
        ));
    }
    let execution_profile_keys =
        modality_contract_execution_profile_keys(modality_runtime_contracts);
    if !execution_profile_keys.is_empty() {
        checks.push(format!(
            "确认 replay 保留 execution profile：{}，用于解释模型角色、权限与 LimeCore policy 合并输入。",
            format_text_list(&execution_profile_keys, "未记录 execution profile")
        ));
    }
    let executor_adapter_keys = modality_contract_executor_adapter_keys(modality_runtime_contracts);
    if !executor_adapter_keys.is_empty() {
        checks.push(format!(
            "确认 replay 保留 executor adapter：{}，用于解释真实执行器绑定、产物输出与失败映射。",
            format_text_list(&executor_adapter_keys, "未记录 executor adapter")
        ));
    }
    if modality_contract_has_task_index(modality_runtime_contracts) {
        checks.push(
            "确认 replay 保留 `snapshotIndex.taskIndex`，用于按 thread / turn / content / entry / modality / executor / cost / limit 复盘任务。"
                .to_string(),
        );
        let identity_anchors =
            modality_contract_task_index_identity_anchors(modality_runtime_contracts);
        if !identity_anchors.is_empty() {
            checks.push(format!(
                "确认 task index 身份锚点仍可回溯：{}。",
                format_text_list(&identity_anchors, "未记录 task index identity")
            ));
        }
        let executor_dimensions =
            modality_contract_task_index_executor_dimensions(modality_runtime_contracts);
        if !executor_dimensions.is_empty() {
            checks.push(format!(
                "确认 task index executor 维度没有漂移：{}。",
                format_text_list(&executor_dimensions, "未记录 executor 维度")
            ));
        }
        let cost_limit_dimensions =
            modality_contract_task_index_cost_limit_dimensions(modality_runtime_contracts);
        if !cost_limit_dimensions.is_empty() {
            checks.push(format!(
                "确认 task index cost/limit 摘要仍来自 runtime facts：{}。",
                format_text_list(&cost_limit_dimensions, "未记录 cost/limit 摘要")
            ));
        }
    }
    if modality_contract_has_limecore_policy_index(modality_runtime_contracts) {
        checks.push(
            "确认 replay 保留 `snapshotIndex.limecorePolicyIndex`，用于解释 LimeCore policy refs、decision source、missing inputs 与 allow / ask / deny 输入。"
                .to_string(),
        );
        let policy_refs = modality_contract_limecore_policy_refs(modality_runtime_contracts);
        if !policy_refs.is_empty() {
            checks.push(format!(
                "确认 LimeCore policy refs 仍可回溯：{}。",
                format_text_list(&policy_refs, "未记录 LimeCore policy refs")
            ));
        }
        let policy_decisions =
            modality_contract_limecore_policy_decisions(modality_runtime_contracts);
        if !policy_decisions.is_empty() {
            checks.push(format!(
                "确认 LimeCore policy decision 仍可解释：{}。",
                format_text_list(&policy_decisions, "未记录 policy decision")
            ));
        }
        let decision_sources =
            modality_contract_limecore_policy_decision_sources(modality_runtime_contracts);
        if !decision_sources.is_empty() {
            checks.push(format!(
                "确认 LimeCore policy decision source 没有漂移：{}。",
                format_text_list(&decision_sources, "未记录 decision source")
            ));
        }
        let missing_inputs =
            modality_contract_limecore_policy_missing_inputs(modality_runtime_contracts);
        if !missing_inputs.is_empty() {
            checks.push(format!(
                "确认 missing inputs 仍显式暴露：{}；如果 replay 已接真实 LimeCore 命中值，必须同步解释这些缺口为何关闭。",
                format_text_list(&missing_inputs, "未记录 missing inputs")
            ));
        }
    }

    if modality_contract_has_routing_block(modality_runtime_contracts) {
        checks.push(format!(
            "存在 `routing_not_possible` / `blocked` 快照，重点回归 capability gap：{}。",
            format_text_list(
                &modality_contract_failure_codes(modality_runtime_contracts),
                "未记录 failureCode"
            )
        ));
    } else {
        checks.push("确认没有把多模态任务降级为普通文本模型或通用文件卡兜底。".to_string());
    }
    if modality_contract_has_browser_control(modality_runtime_contracts) {
        checks.push(
            "确认 `browser_control` replay 使用 Browser Assist / `mcp__lime-browser__*`，而不是把网页动作降级为 WebSearch、普通聊天总结或 Playwright 旁路。"
                .to_string(),
        );
        checks.push(
            "确认 evidence 中存在 `browser_action_trace` 或 `browser_action_requested` 快照，能证明浏览器执行器真实被调用。"
                .to_string(),
        );
        checks.push(
            "确认 `snapshotIndex.browserActionIndex` 已汇总 browser session / snapshot 的 action、session、URL、observation 与 screenshot 计数。"
                .to_string(),
        );
    }
    if modality_contract_has_pdf_extract(modality_runtime_contracts) {
        checks.push(
            "确认 `pdf_extract` replay 使用 `Skill(pdf_read)`，或在 timeline 中保留真实 `list_directory` / `read_file` 文件读取证据。"
                .to_string(),
        );
        checks.push(
            "确认没有把 PDF 读取降级为 `frontend_direct_pdf_parse`、`generic_chat_summary_only`、ToolSearch、WebSearch 或 Grep 目录检索替代；最终结论必须能回溯到实际读取内容。"
                .to_string(),
        );
    }
    if modality_contract_has_voice_generation(modality_runtime_contracts) {
        checks.push(
            "确认 `voice_generation` replay 使用 `service_scene_launch(scene_key=voice_runtime)` / 本地 ServiceSkill runtime，并保留 voice_runtime service scene trace 或 audio_task/audio_output 产物证据。"
                .to_string(),
        );
        if modality_contract_has_voice_audio_output_completed(modality_runtime_contracts) {
            checks.push(
                "确认 `audio_generate` task artifact 中的 `audio_output.completed`、`audio_path`、provider / model 仍能从 evidence 回溯，不能只把音频结果降级为 Markdown 文本。"
                    .to_string(),
            );
        }
        if modality_contract_has_voice_audio_output_failed(modality_runtime_contracts) {
            checks.push(format!(
                "确认 replay 对 `audio_output.failed` 的处理仍保留 Provider 错误码：{}，不能静默回退 legacy TTS 或伪造音频路径。",
                format_text_list(
                    &modality_contract_voice_audio_output_error_codes(modality_runtime_contracts),
                    "未记录 audio_output errorCode"
                )
            ));
        }
        checks.push(
            "确认没有把配音降级为 `legacy_tts_test_command`、`fake_cloud_scene_submitted`、普通聊天文案、通用文件卡或只展示文本结果。"
                .to_string(),
        );
    }
    if modality_contract_has_audio_transcription(modality_runtime_contracts) {
        checks.push(
            "确认 `audio_transcription` replay 使用 `Skill(transcription_generate)`，并保留 transcription_generate task artifact / transcript 产物证据。"
                .to_string(),
        );
        checks.push(
            "确认 `snapshotIndex.transcriptIndex` 已汇总 transcript 状态、来源、语言、输出格式与 provider / model。"
                .to_string(),
        );
        if modality_contract_has_transcript_completed(modality_runtime_contracts) {
            checks.push(
                "确认 `transcription_generate` task artifact 中的 `transcript.completed`、`transcriptPath`、provider / model 仍能从 evidence 回溯，不能只把转写结果降级为 Markdown 文本。"
                    .to_string(),
            );
        }
        if modality_contract_has_transcript_failed(modality_runtime_contracts) {
            checks.push(format!(
                "确认 replay 对 `transcript.failed` 的处理仍保留 Provider 错误码：{}，不能静默回退 frontend ASR 或伪造 transcriptPath。",
                format_text_list(
                    &modality_contract_transcript_error_codes(modality_runtime_contracts),
                    "未记录 transcript errorCode"
                )
            ));
        }
        checks.push(
            "确认没有把转写降级为 `frontend_direct_asr`、`generic_file_transcript`、`tool_search_before_transcription_skill`、普通文件读取或普通聊天摘要。"
                .to_string(),
        );
    }
    if modality_contract_has_web_research(modality_runtime_contracts) {
        checks.push(
            "确认 `web_research` replay 使用 `Skill(research)`、`Skill(site_search)` 或 `Skill(report_generate)`，并保留真实 search_query / lime_site_* 工具时间线。"
                .to_string(),
        );
        checks.push(
            "确认没有把联网研究降级为 `model_memory_only_answer`、`local_file_search_before_research_skill`、ToolSearch、通用 WebSearch 绕过站点搜索，或普通聊天摘要。"
                .to_string(),
        );
    }
    if modality_contract_has_text_transform(modality_runtime_contracts) {
        checks.push(
            "确认 `text_transform` replay 使用 `Skill(summary)`、`Skill(translation)` 或 `Skill(analysis)`，并在显式文件路径场景保留真实 list_directory / read_file 证据。"
                .to_string(),
        );
        checks.push(
            "确认没有把文本/文档转换降级为 `frontend_direct_text_transform`、`tool_search_before_text_transform_skill`、`web_search_before_text_transform_skill`、通用 WebSearch 或普通聊天摘要。"
                .to_string(),
        );
    }

    checks
}

fn build_artifact_checks(recent_artifacts: &[String]) -> Vec<String> {
    if recent_artifacts.is_empty() {
        return vec!["当前没有显式 artifact 快照，重点检查结果和证据链是否闭环。".to_string()];
    }

    recent_artifacts
        .iter()
        .take(4)
        .map(|path| format!("确认 `{path}` 仍与当前目标一致，且没有被回放结果无意破坏。"))
        .collect()
}

fn infer_replay_suite_tags(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    handoff_bundle: &RuntimeHandoffBundleExportResult,
    evidence_pack: &RuntimeEvidencePackExportResult,
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let mut tags = Vec::new();

    push_unique_text_tag(&mut tags, "conversation-runtime");
    push_unique_text_tag(&mut tags, "replay");
    push_unique_text_tag(&mut tags, "runtime-export");

    if let Some(strategy) = normalize_optional_text(detail.execution_strategy.clone()) {
        push_unique_owned_tag(&mut tags, format!("execution-strategy-{strategy}"));
    }

    if !handoff_bundle.artifacts.is_empty() {
        push_unique_text_tag(&mut tags, "handoff");
    }

    if !evidence_pack.artifacts.is_empty() {
        push_unique_text_tag(&mut tags, "evidence");
    }

    if !thread_read.pending_requests.is_empty() {
        push_unique_text_tag(&mut tags, "pending-request");
    }

    if !thread_read.queued_turns.is_empty() {
        push_unique_text_tag(&mut tags, "queued-turn");
    }

    if !detail.child_subagent_sessions.is_empty() {
        push_unique_text_tag(&mut tags, "subagent");
    }

    if !thread_read.incidents.is_empty() {
        push_unique_text_tag(&mut tags, "incident");
    }

    if modality_contract_snapshot_count(modality_runtime_contracts) > 0 {
        push_unique_text_tag(&mut tags, "modality-runtime-contract");
        for contract_key in modality_contract_keys(modality_runtime_contracts) {
            push_unique_owned_tag(&mut tags, format!("modality-{contract_key}"));
        }
        if !modality_contract_execution_profile_keys(modality_runtime_contracts).is_empty() {
            push_unique_text_tag(&mut tags, "execution-profile");
        }
        if !modality_contract_executor_adapter_keys(modality_runtime_contracts).is_empty() {
            push_unique_text_tag(&mut tags, "executor-adapter");
        }
        if modality_contract_has_limecore_policy_index(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "limecore-policy");
        }
        if modality_contract_has_task_index(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "modality-task-index");
        }
        if !modality_contract_task_index_identity_anchors(modality_runtime_contracts).is_empty() {
            push_unique_text_tag(&mut tags, "modality-task-identity");
        }
        if !modality_contract_task_index_cost_limit_dimensions(modality_runtime_contracts)
            .is_empty()
        {
            push_unique_text_tag(&mut tags, "modality-task-cost-limit");
        }
        if !modality_contract_limecore_policy_missing_inputs(modality_runtime_contracts).is_empty()
        {
            push_unique_text_tag(&mut tags, "limecore-policy-gap");
        }
        if modality_contract_has_limecore_local_default_policy(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "limecore-local-default-policy");
        }
    }

    if modality_contract_has_routing_block(modality_runtime_contracts) {
        push_unique_text_tag(&mut tags, "routing-not-possible");
    }
    if modality_contract_has_browser_control(modality_runtime_contracts) {
        push_unique_text_tag(&mut tags, "browser-control");
        push_unique_text_tag(&mut tags, "browser-assist");
        if modality_contract_has_browser_action_trace(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "browser-action-trace");
        }
        if modality_contract_has_browser_action_index(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "browser-action-index");
        }
    }
    if modality_contract_has_pdf_extract(modality_runtime_contracts) {
        push_unique_text_tag(&mut tags, "pdf-extract");
        push_unique_text_tag(&mut tags, "pdf-read-skill");
        if modality_contract_has_pdf_skill_trace(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "pdf-read-trace");
        }
    }
    if modality_contract_has_voice_generation(modality_runtime_contracts) {
        push_unique_text_tag(&mut tags, "voice-generation");
        push_unique_text_tag(&mut tags, "voice-runtime");
        if modality_contract_has_voice_generation_service_trace(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "voice-generation-trace");
        }
        if modality_contract_has_voice_audio_output_completed(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "audio-output-completed");
        }
        if modality_contract_has_voice_audio_output_failed(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "audio-output-failed");
        }
    }
    if modality_contract_has_audio_transcription(modality_runtime_contracts) {
        push_unique_text_tag(&mut tags, "audio-transcription");
        push_unique_text_tag(&mut tags, "transcription-generate");
        if modality_contract_has_audio_transcription_task_trace(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "transcription-task-trace");
        }
        if modality_contract_has_transcript_index(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "transcript-index");
        }
        if modality_contract_has_transcript_completed(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "transcript-completed");
        }
        if modality_contract_has_transcript_failed(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "transcript-failed");
        }
    }
    if modality_contract_has_web_research(modality_runtime_contracts) {
        push_unique_text_tag(&mut tags, "web-research");
        push_unique_text_tag(&mut tags, "research-skill");
        if modality_contract_has_web_research_skill_trace(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "web-research-trace");
        }
    }
    if modality_contract_has_text_transform(modality_runtime_contracts) {
        push_unique_text_tag(&mut tags, "text-transform");
        push_unique_text_tag(&mut tags, "text-transform-skill");
        if modality_contract_has_text_transform_skill_trace(modality_runtime_contracts) {
            push_unique_text_tag(&mut tags, "text-transform-trace");
        }
    }

    tags
}

fn infer_replay_failure_modes(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let mut failure_modes = Vec::new();

    if let Some(primary_blocking_kind) = thread_read
        .diagnostics
        .as_ref()
        .and_then(|value| normalize_optional_text(value.primary_blocking_kind.clone()))
    {
        push_unique_owned_tag(&mut failure_modes, primary_blocking_kind);
    }

    if !thread_read.pending_requests.is_empty() {
        push_unique_text_tag(&mut failure_modes, "pending_request");
    }

    if !thread_read.queued_turns.is_empty() {
        push_unique_text_tag(&mut failure_modes, "queued_turn_backlog");
    }

    if !thread_read.incidents.is_empty() {
        push_unique_text_tag(&mut failure_modes, "incident_present");
    }

    if detail
        .todo_items
        .iter()
        .any(|item| !session_todo_completed(item))
    {
        push_unique_text_tag(&mut failure_modes, "unfinished_todo");
    }

    if !detail.child_subagent_sessions.is_empty() {
        push_unique_text_tag(&mut failure_modes, "subagent_in_progress");
    }

    if let Some(latest_turn_status) = thread_read
        .diagnostics
        .as_ref()
        .and_then(|value| normalize_optional_text(value.latest_turn_status.clone()))
        .or_else(|| {
            detail
                .turns
                .last()
                .map(|turn| turn.status.as_str().trim().to_string())
                .and_then(|value| normalize_optional_text(Some(value)))
        })
    {
        if latest_turn_status.contains("fail") {
            push_unique_text_tag(&mut failure_modes, "turn_failed");
        }
        if latest_turn_status.contains("interrupt") {
            push_unique_text_tag(&mut failure_modes, "turn_interrupted");
        }
    }

    if modality_contract_has_routing_block(modality_runtime_contracts) {
        push_unique_text_tag(&mut failure_modes, "modality_contract_routing_blocked");
    }
    if modality_contract_snapshot_count(modality_runtime_contracts) > 0
        && !modality_contract_has_task_index(modality_runtime_contracts)
    {
        push_unique_text_tag(&mut failure_modes, "modality_task_index_missing");
    }
    if !modality_contract_limecore_policy_missing_inputs(modality_runtime_contracts).is_empty() {
        push_unique_text_tag(&mut failure_modes, "limecore_policy_missing_inputs");
    }
    if modality_contract_has_limecore_local_default_policy(modality_runtime_contracts) {
        push_unique_text_tag(&mut failure_modes, "limecore_policy_local_defaults_only");
    }
    if modality_contract_has_browser_control(modality_runtime_contracts)
        && !modality_contract_has_browser_action_trace(modality_runtime_contracts)
    {
        push_unique_text_tag(&mut failure_modes, "browser_control_missing_action_trace");
    }
    if modality_contract_has_browser_control(modality_runtime_contracts)
        && !modality_contract_has_browser_action_index(modality_runtime_contracts)
    {
        push_unique_text_tag(&mut failure_modes, "browser_control_missing_action_index");
    }
    if modality_contract_has_pdf_extract(modality_runtime_contracts)
        && !modality_contract_has_pdf_skill_trace(modality_runtime_contracts)
    {
        push_unique_text_tag(&mut failure_modes, "pdf_extract_missing_skill_trace");
    }
    if modality_contract_has_voice_generation(modality_runtime_contracts)
        && !modality_contract_has_voice_generation_service_trace(modality_runtime_contracts)
    {
        push_unique_text_tag(&mut failure_modes, "voice_generation_missing_service_trace");
    }
    if modality_contract_has_voice_audio_output_failed(modality_runtime_contracts) {
        push_unique_text_tag(&mut failure_modes, "voice_generation_audio_output_failed");
        for error_code in
            modality_contract_voice_audio_output_error_codes(modality_runtime_contracts)
        {
            push_unique_owned_tag(&mut failure_modes, error_code);
        }
    }
    if modality_contract_has_audio_transcription(modality_runtime_contracts)
        && !modality_contract_has_audio_transcription_task_trace(modality_runtime_contracts)
    {
        push_unique_text_tag(&mut failure_modes, "audio_transcription_missing_task_trace");
    }
    if modality_contract_has_audio_transcription(modality_runtime_contracts)
        && !modality_contract_has_transcript_index(modality_runtime_contracts)
    {
        push_unique_text_tag(
            &mut failure_modes,
            "audio_transcription_missing_transcript_index",
        );
    }
    if modality_contract_has_transcript_failed(modality_runtime_contracts) {
        push_unique_text_tag(&mut failure_modes, "audio_transcription_transcript_failed");
        for error_code in modality_contract_transcript_error_codes(modality_runtime_contracts) {
            push_unique_owned_tag(&mut failure_modes, error_code);
        }
    }
    if modality_contract_has_web_research(modality_runtime_contracts)
        && !modality_contract_has_web_research_skill_trace(modality_runtime_contracts)
    {
        push_unique_text_tag(&mut failure_modes, "web_research_missing_skill_trace");
    }
    if modality_contract_has_text_transform(modality_runtime_contracts)
        && !modality_contract_has_text_transform_skill_trace(modality_runtime_contracts)
    {
        push_unique_text_tag(&mut failure_modes, "text_transform_missing_skill_trace");
    }
    for failure_code in modality_contract_failure_codes(modality_runtime_contracts) {
        push_unique_owned_tag(&mut failure_modes, failure_code);
    }

    failure_modes
}

fn modality_contract_snapshots(modality_runtime_contracts: &Value) -> Vec<&Value> {
    modality_runtime_contracts
        .pointer("/snapshots")
        .and_then(Value::as_array)
        .map(|items| items.iter().collect())
        .unwrap_or_default()
}

fn modality_contract_snapshot_count(modality_runtime_contracts: &Value) -> usize {
    modality_runtime_contracts
        .pointer("/snapshotCount")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or_else(|| modality_contract_snapshots(modality_runtime_contracts).len())
}

fn modality_contract_keys(modality_runtime_contracts: &Value) -> Vec<String> {
    collect_unique_snapshot_strings(modality_runtime_contracts, "contractKey")
}

fn modality_contract_models(modality_runtime_contracts: &Value) -> Vec<String> {
    collect_unique_snapshot_strings(modality_runtime_contracts, "model")
}

fn modality_contract_failure_codes(modality_runtime_contracts: &Value) -> Vec<String> {
    collect_unique_snapshot_strings(modality_runtime_contracts, "failureCode")
}

fn modality_contract_execution_profile_keys(modality_runtime_contracts: &Value) -> Vec<String> {
    let mut values =
        collect_unique_snapshot_strings(modality_runtime_contracts, "executionProfileKey");
    collect_unique_snapshot_strings_into(
        modality_runtime_contracts,
        "execution_profile_key",
        &mut values,
    );
    collect_unique_string_array_at_pointer(
        modality_runtime_contracts,
        "/snapshotIndex/executionProfileKeys",
        &mut values,
    );
    collect_unique_string_array_at_pointer(
        modality_runtime_contracts,
        "/snapshot_index/execution_profile_keys",
        &mut values,
    );
    values
}

fn modality_contract_executor_adapter_keys(modality_runtime_contracts: &Value) -> Vec<String> {
    let mut values =
        collect_unique_snapshot_strings(modality_runtime_contracts, "executorAdapterKey");
    collect_unique_snapshot_strings_into(
        modality_runtime_contracts,
        "executor_adapter_key",
        &mut values,
    );
    collect_unique_string_array_at_pointer(
        modality_runtime_contracts,
        "/snapshotIndex/executorAdapterKeys",
        &mut values,
    );
    collect_unique_string_array_at_pointer(
        modality_runtime_contracts,
        "/snapshot_index/executor_adapter_keys",
        &mut values,
    );
    values
}

fn modality_contract_task_index(modality_runtime_contracts: &Value) -> Option<&Value> {
    modality_runtime_contracts
        .pointer("/snapshotIndex/taskIndex")
        .or_else(|| modality_runtime_contracts.pointer("/snapshot_index/task_index"))
}

fn modality_contract_has_task_index(modality_runtime_contracts: &Value) -> bool {
    modality_contract_task_index_snapshot_count(modality_runtime_contracts) > 0
        || modality_contract_task_index(modality_runtime_contracts)
            .is_some_and(|index| modality_contract_task_index_item_count(index) > 0)
}

fn modality_contract_task_index_snapshot_count(modality_runtime_contracts: &Value) -> usize {
    modality_contract_task_index(modality_runtime_contracts)
        .and_then(|index| {
            index
                .get("snapshotCount")
                .or_else(|| index.get("snapshot_count"))
        })
        .and_then(Value::as_u64)
        .map(|count| count as usize)
        .unwrap_or_else(|| {
            modality_contract_task_index(modality_runtime_contracts)
                .map(modality_contract_task_index_item_count)
                .unwrap_or_default()
        })
}

fn modality_contract_task_index_item_count(index: &Value) -> usize {
    index
        .get("items")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default()
}

fn modality_contract_task_index_quota_low_count(index: &Value) -> usize {
    index
        .get("quotaLowCount")
        .or_else(|| index.get("quota_low_count"))
        .and_then(Value::as_u64)
        .map(|count| count as usize)
        .unwrap_or_else(|| {
            index
                .get("items")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter(|item| {
                            item.get("quotaLow")
                                .or_else(|| item.get("quota_low"))
                                .and_then(Value::as_bool)
                                == Some(true)
                        })
                        .count()
                })
                .unwrap_or_default()
        })
}

fn modality_contract_task_index_strings(
    index: &Value,
    array_camel_key: &str,
    array_snake_key: &str,
    item_camel_key: &str,
    item_snake_key: &str,
) -> Vec<String> {
    let mut values = Vec::new();
    collect_unique_string_array_fields(index, &[array_camel_key, array_snake_key], &mut values);
    for item in index
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        collect_unique_string_fields(item, &[item_camel_key, item_snake_key], &mut values);
    }
    values
}

fn modality_contract_task_index_identity_anchors(
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let Some(index) = modality_contract_task_index(modality_runtime_contracts) else {
        return Vec::new();
    };

    let mut values = modality_contract_task_index_strings(
        index,
        "threadIds",
        "thread_ids",
        "threadId",
        "thread_id",
    );
    for value in
        modality_contract_task_index_strings(index, "turnIds", "turn_ids", "turnId", "turn_id")
    {
        push_unique_owned_tag(&mut values, value);
    }
    for value in modality_contract_task_index_strings(
        index,
        "contentIds",
        "content_ids",
        "contentId",
        "content_id",
    ) {
        push_unique_owned_tag(&mut values, value);
    }
    for value in modality_contract_task_index_strings(
        index,
        "entryKeys",
        "entry_keys",
        "entryKey",
        "entry_key",
    ) {
        push_unique_owned_tag(&mut values, value);
    }
    values
}

fn modality_contract_task_index_executor_dimensions(
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let Some(index) = modality_contract_task_index(modality_runtime_contracts) else {
        return Vec::new();
    };

    let mut values = modality_contract_task_index_strings(
        index,
        "modalities",
        "modalities",
        "modality",
        "modality",
    );
    for value in
        modality_contract_task_index_strings(index, "skillIds", "skill_ids", "skillId", "skill_id")
    {
        push_unique_owned_tag(&mut values, value);
    }
    for value in
        modality_contract_task_index_strings(index, "modelIds", "model_ids", "modelId", "model_id")
    {
        push_unique_owned_tag(&mut values, value);
    }
    for value in modality_contract_task_index_strings(
        index,
        "executorKinds",
        "executor_kinds",
        "executorKind",
        "executor_kind",
    ) {
        push_unique_owned_tag(&mut values, value);
    }
    for value in modality_contract_task_index_strings(
        index,
        "executorBindingKeys",
        "executor_binding_keys",
        "executorBindingKey",
        "executor_binding_key",
    ) {
        push_unique_owned_tag(&mut values, value);
    }
    values
}

fn modality_contract_task_index_cost_limit_dimensions(
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let Some(index) = modality_contract_task_index(modality_runtime_contracts) else {
        return Vec::new();
    };

    let mut values = modality_contract_task_index_strings(
        index,
        "costStates",
        "cost_states",
        "costState",
        "cost_state",
    );
    for value in modality_contract_task_index_strings(
        index,
        "limitStates",
        "limit_states",
        "limitState",
        "limit_state",
    ) {
        push_unique_owned_tag(&mut values, value);
    }
    for value in modality_contract_task_index_strings(
        index,
        "estimatedCostClasses",
        "estimated_cost_classes",
        "estimatedCostClass",
        "estimated_cost_class",
    ) {
        push_unique_owned_tag(&mut values, value);
    }
    for value in modality_contract_task_index_strings(
        index,
        "limitEventKinds",
        "limit_event_kinds",
        "limitEventKind",
        "limit_event_kind",
    ) {
        push_unique_owned_tag(&mut values, value);
    }
    if modality_contract_task_index_quota_low_count(index) > 0 {
        push_unique_text_tag(&mut values, "quota_low");
    }
    values
}

fn modality_contract_limecore_policy_index(modality_runtime_contracts: &Value) -> Option<&Value> {
    modality_runtime_contracts
        .pointer("/snapshotIndex/limecorePolicyIndex")
        .or_else(|| modality_runtime_contracts.pointer("/snapshot_index/limecore_policy_index"))
}

fn modality_contract_has_limecore_policy_index(modality_runtime_contracts: &Value) -> bool {
    modality_contract_limecore_policy_index(modality_runtime_contracts)
        .and_then(|value| {
            value
                .get("snapshotCount")
                .or_else(|| value.get("snapshot_count"))
        })
        .and_then(Value::as_u64)
        .is_some_and(|count| count > 0)
        || modality_contract_limecore_policy_index(modality_runtime_contracts)
            .and_then(|value| value.get("items"))
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
}

fn modality_contract_limecore_policy_refs(modality_runtime_contracts: &Value) -> Vec<String> {
    let mut values = Vec::new();
    collect_unique_string_array_at_pointer(
        modality_runtime_contracts,
        "/snapshotIndex/limecorePolicyRefs",
        &mut values,
    );
    collect_unique_string_array_at_pointer(
        modality_runtime_contracts,
        "/snapshot_index/limecore_policy_refs",
        &mut values,
    );
    if let Some(index) = modality_contract_limecore_policy_index(modality_runtime_contracts) {
        collect_unique_string_array_fields(index, &["refKeys", "ref_keys"], &mut values);
        for item in index
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            collect_unique_string_array_fields(item, &["refs"], &mut values);
        }
    }
    for snapshot in modality_contract_snapshots(modality_runtime_contracts) {
        collect_unique_string_array_fields(
            snapshot,
            &["limecorePolicyRefs", "limecore_policy_refs"],
            &mut values,
        );
        if let Some(snapshot_policy) = snapshot
            .get("limecorePolicySnapshot")
            .or_else(|| snapshot.get("limecore_policy_snapshot"))
        {
            collect_unique_string_array_fields(snapshot_policy, &["refs"], &mut values);
        }
    }
    values
}

fn modality_contract_limecore_policy_missing_inputs(
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let mut values = Vec::new();
    if let Some(index) = modality_contract_limecore_policy_index(modality_runtime_contracts) {
        collect_unique_string_array_fields(
            index,
            &["missingInputs", "missing_inputs"],
            &mut values,
        );
        for item in index
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            collect_unique_string_array_fields(
                item,
                &[
                    "missingInputs",
                    "missing_inputs",
                    "unresolvedRefs",
                    "unresolved_refs",
                ],
                &mut values,
            );
        }
    }
    for snapshot in modality_contract_snapshots(modality_runtime_contracts) {
        if let Some(snapshot_policy) = snapshot
            .get("limecorePolicySnapshot")
            .or_else(|| snapshot.get("limecore_policy_snapshot"))
        {
            collect_unique_string_array_fields(
                snapshot_policy,
                &[
                    "missingInputs",
                    "missing_inputs",
                    "unresolvedRefs",
                    "unresolved_refs",
                ],
                &mut values,
            );
        }
    }
    values
}

fn modality_contract_limecore_policy_decisions(modality_runtime_contracts: &Value) -> Vec<String> {
    let mut values = Vec::new();
    if let Some(index) = modality_contract_limecore_policy_index(modality_runtime_contracts) {
        if let Some(counts) = index
            .get("decisionCounts")
            .or_else(|| index.get("decision_counts"))
            .and_then(Value::as_array)
        {
            for count in counts {
                collect_unique_string_fields(count, &["decision"], &mut values);
            }
        }
        for item in index
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            collect_unique_string_fields(item, &["decision"], &mut values);
        }
    }
    for snapshot in modality_contract_snapshots(modality_runtime_contracts) {
        if let Some(snapshot_policy) = snapshot
            .get("limecorePolicySnapshot")
            .or_else(|| snapshot.get("limecore_policy_snapshot"))
        {
            collect_unique_string_fields(snapshot_policy, &["decision"], &mut values);
        }
    }
    values
}

fn modality_contract_limecore_policy_decision_sources(
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let mut values = Vec::new();
    if let Some(index) = modality_contract_limecore_policy_index(modality_runtime_contracts) {
        for item in index
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            collect_unique_string_fields(item, &["decisionSource", "decision_source"], &mut values);
        }
    }
    for snapshot in modality_contract_snapshots(modality_runtime_contracts) {
        if let Some(snapshot_policy) = snapshot
            .get("limecorePolicySnapshot")
            .or_else(|| snapshot.get("limecore_policy_snapshot"))
        {
            collect_unique_string_fields(
                snapshot_policy,
                &["decisionSource", "decision_source"],
                &mut values,
            );
        }
    }
    values
}

fn modality_contract_has_limecore_local_default_policy(modality_runtime_contracts: &Value) -> bool {
    modality_contract_limecore_policy_decision_sources(modality_runtime_contracts)
        .iter()
        .any(|source| source == "local_default_policy")
        || modality_contract_limecore_policy_items(modality_runtime_contracts)
            .into_iter()
            .any(|item| {
                item.get("decisionScope")
                    .or_else(|| item.get("decision_scope"))
                    .and_then(Value::as_str)
                    .is_some_and(|value| value == "local_defaults_only")
            })
}

fn modality_contract_limecore_policy_items(modality_runtime_contracts: &Value) -> Vec<&Value> {
    let mut items = Vec::new();
    if let Some(index) = modality_contract_limecore_policy_index(modality_runtime_contracts) {
        if let Some(index_items) = index.get("items").and_then(Value::as_array) {
            items.extend(index_items.iter());
        }
    }
    for snapshot in modality_contract_snapshots(modality_runtime_contracts) {
        if let Some(snapshot_policy) = snapshot
            .get("limecorePolicySnapshot")
            .or_else(|| snapshot.get("limecore_policy_snapshot"))
        {
            items.push(snapshot_policy);
        }
    }
    items
}

fn modality_contract_has_browser_control(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == BROWSER_CONTROL_CONTRACT_KEY)
                .unwrap_or(false)
        })
}

fn modality_contract_has_browser_action_trace(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            snapshot
                .get("source")
                .and_then(Value::as_str)
                .map(|value| value.contains("browser_action_trace"))
                .unwrap_or(false)
                || snapshot
                    .get("routingEvent")
                    .and_then(Value::as_str)
                    .map(|value| value == "browser_action_requested")
                    .unwrap_or(false)
        })
}

fn modality_contract_has_browser_action_index(modality_runtime_contracts: &Value) -> bool {
    modality_runtime_contracts
        .pointer("/snapshotIndex/browserActionIndex/actionCount")
        .and_then(Value::as_u64)
        .is_some_and(|count| count > 0)
        || modality_runtime_contracts
            .pointer("/snapshotIndex/browserActionIndex/items")
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
}

fn modality_contract_has_pdf_extract(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == PDF_EXTRACT_CONTRACT_KEY)
                .unwrap_or(false)
        })
}

fn modality_contract_has_pdf_skill_trace(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            snapshot
                .get("source")
                .and_then(Value::as_str)
                .map(|value| {
                    value.contains("pdf_read_skill_trace")
                        || value.contains("pdf_extract_file_trace")
                })
                .unwrap_or(false)
                || snapshot
                    .get("routingEvent")
                    .and_then(Value::as_str)
                    .map(|value| value == "executor_invoked")
                    .unwrap_or(false)
        })
}

fn modality_contract_has_voice_generation(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == VOICE_GENERATION_CONTRACT_KEY)
                .unwrap_or(false)
        })
}

fn modality_contract_has_voice_generation_service_trace(
    modality_runtime_contracts: &Value,
) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            let is_voice_generation = snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == VOICE_GENERATION_CONTRACT_KEY)
                .unwrap_or(false);
            if !is_voice_generation {
                return false;
            }

            snapshot
                .get("source")
                .and_then(Value::as_str)
                .map(|value| {
                    value.contains("voice_generation_service_scene_trace")
                        || value.contains("audio_task")
                        || value.contains("audio_output")
                })
                .unwrap_or(false)
                || snapshot
                    .get("routingEvent")
                    .and_then(Value::as_str)
                    .map(|value| value == "executor_invoked")
                    .unwrap_or(false)
        })
}

fn modality_contract_voice_audio_outputs(modality_runtime_contracts: &Value) -> Vec<&Value> {
    modality_contract_snapshots(modality_runtime_contracts)
        .into_iter()
        .filter(|snapshot| {
            snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == VOICE_GENERATION_CONTRACT_KEY)
                .unwrap_or(false)
        })
        .filter_map(|snapshot| snapshot.get("audioOutput"))
        .filter(|value| value.is_object())
        .collect()
}

fn modality_contract_has_voice_audio_output_completed(modality_runtime_contracts: &Value) -> bool {
    modality_contract_voice_audio_outputs(modality_runtime_contracts)
        .iter()
        .any(|audio_output| {
            let completed = audio_output
                .get("status")
                .and_then(Value::as_str)
                .map(|value| value == "completed")
                .unwrap_or(false);
            let has_audio_path = audio_output
                .get("audioPath")
                .and_then(Value::as_str)
                .and_then(|value| normalize_optional_text(Some(value.to_string())))
                .is_some();
            completed && has_audio_path
        })
}

fn modality_contract_has_voice_audio_output_failed(modality_runtime_contracts: &Value) -> bool {
    modality_contract_voice_audio_outputs(modality_runtime_contracts)
        .iter()
        .any(|audio_output| {
            audio_output
                .get("status")
                .and_then(Value::as_str)
                .map(|value| value == "failed")
                .unwrap_or(false)
                || audio_output
                    .get("errorCode")
                    .and_then(Value::as_str)
                    .and_then(|value| normalize_optional_text(Some(value.to_string())))
                    .is_some()
        })
}

fn modality_contract_voice_audio_output_error_codes(
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let mut error_codes = Vec::new();
    for audio_output in modality_contract_voice_audio_outputs(modality_runtime_contracts) {
        if let Some(error_code) = audio_output
            .get("errorCode")
            .and_then(Value::as_str)
            .and_then(|value| normalize_optional_text(Some(value.to_string())))
        {
            push_unique_owned_tag(&mut error_codes, error_code);
        }
    }
    error_codes
}

fn modality_contract_has_audio_transcription(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == AUDIO_TRANSCRIPTION_CONTRACT_KEY)
                .unwrap_or(false)
        })
}

fn modality_contract_has_audio_transcription_task_trace(
    modality_runtime_contracts: &Value,
) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            let is_audio_transcription = snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == AUDIO_TRANSCRIPTION_CONTRACT_KEY)
                .unwrap_or(false);
            if !is_audio_transcription {
                return false;
            }

            snapshot
                .get("source")
                .and_then(Value::as_str)
                .map(|value| {
                    value.contains("transcription_task")
                        || value.contains("transcription_skill_trace")
                        || value.contains("transcript")
                })
                .unwrap_or(false)
                || snapshot
                    .get("routingEvent")
                    .and_then(Value::as_str)
                    .map(|value| value == "executor_invoked")
                    .unwrap_or(false)
        })
}

fn modality_contract_has_transcript_index(modality_runtime_contracts: &Value) -> bool {
    modality_runtime_contracts
        .pointer("/snapshotIndex/transcriptIndex/transcriptCount")
        .and_then(Value::as_u64)
        .is_some_and(|count| count > 0)
        || modality_runtime_contracts
            .pointer("/snapshotIndex/transcriptIndex/items")
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
}

fn modality_contract_transcripts(modality_runtime_contracts: &Value) -> Vec<&Value> {
    modality_contract_snapshots(modality_runtime_contracts)
        .into_iter()
        .filter(|snapshot| {
            snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == AUDIO_TRANSCRIPTION_CONTRACT_KEY)
                .unwrap_or(false)
        })
        .filter_map(|snapshot| snapshot.get("transcript"))
        .filter(|value| value.is_object())
        .collect()
}

fn modality_contract_has_transcript_completed(modality_runtime_contracts: &Value) -> bool {
    modality_contract_transcripts(modality_runtime_contracts)
        .iter()
        .any(|transcript| {
            let completed = transcript
                .get("status")
                .and_then(Value::as_str)
                .map(|value| value == "completed")
                .unwrap_or(false);
            let has_transcript_path = transcript
                .get("transcriptPath")
                .and_then(Value::as_str)
                .and_then(|value| normalize_optional_text(Some(value.to_string())))
                .is_some();
            completed && has_transcript_path
        })
}

fn modality_contract_has_transcript_failed(modality_runtime_contracts: &Value) -> bool {
    modality_contract_transcripts(modality_runtime_contracts)
        .iter()
        .any(|transcript| {
            transcript
                .get("status")
                .and_then(Value::as_str)
                .map(|value| value == "failed")
                .unwrap_or(false)
                || transcript
                    .get("errorCode")
                    .and_then(Value::as_str)
                    .and_then(|value| normalize_optional_text(Some(value.to_string())))
                    .is_some()
        })
}

fn modality_contract_transcript_error_codes(modality_runtime_contracts: &Value) -> Vec<String> {
    let mut error_codes = Vec::new();
    for transcript in modality_contract_transcripts(modality_runtime_contracts) {
        if let Some(error_code) = transcript
            .get("errorCode")
            .and_then(Value::as_str)
            .and_then(|value| normalize_optional_text(Some(value.to_string())))
        {
            push_unique_owned_tag(&mut error_codes, error_code);
        }
    }
    error_codes
}

fn modality_contract_has_web_research(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == WEB_RESEARCH_CONTRACT_KEY)
                .unwrap_or(false)
        })
}

fn modality_contract_has_web_research_skill_trace(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            let is_web_research = snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == WEB_RESEARCH_CONTRACT_KEY)
                .unwrap_or(false);
            if !is_web_research {
                return false;
            }

            snapshot
                .get("source")
                .and_then(Value::as_str)
                .map(|value| value.contains("web_research_skill_trace"))
                .unwrap_or(false)
                || snapshot
                    .get("routingEvent")
                    .and_then(Value::as_str)
                    .map(|value| value == "executor_invoked")
                    .unwrap_or(false)
        })
}

fn modality_contract_has_text_transform(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == TEXT_TRANSFORM_CONTRACT_KEY)
                .unwrap_or(false)
        })
}

fn modality_contract_has_text_transform_skill_trace(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            let is_text_transform = snapshot
                .get("contractKey")
                .and_then(Value::as_str)
                .map(|value| value == TEXT_TRANSFORM_CONTRACT_KEY)
                .unwrap_or(false);
            if !is_text_transform {
                return false;
            }

            snapshot
                .get("source")
                .and_then(Value::as_str)
                .map(|value| value.contains("text_transform_skill_trace"))
                .unwrap_or(false)
                || snapshot
                    .get("routingEvent")
                    .and_then(Value::as_str)
                    .map(|value| value == "executor_invoked")
                    .unwrap_or(false)
        })
}

fn modality_contract_model_capability_assessment_sources(
    modality_runtime_contracts: &Value,
) -> Vec<String> {
    let mut values = Vec::new();
    for snapshot in modality_contract_snapshots(modality_runtime_contracts) {
        if let Some(value) = snapshot
            .pointer("/modelCapabilityAssessment/source")
            .and_then(Value::as_str)
            .and_then(|value| normalize_optional_text(Some(value.to_string())))
        {
            push_unique_owned_tag(&mut values, value);
        }
    }
    values
}

fn modality_contract_has_routing_block(modality_runtime_contracts: &Value) -> bool {
    modality_contract_snapshots(modality_runtime_contracts)
        .iter()
        .any(|snapshot| {
            snapshot
                .get("routingEvent")
                .and_then(Value::as_str)
                .map(|value| value == "routing_not_possible")
                .unwrap_or(false)
                || snapshot
                    .get("routingOutcome")
                    .and_then(Value::as_str)
                    .map(|value| value == "blocked")
                    .unwrap_or(false)
        })
}

fn collect_unique_snapshot_strings(
    modality_runtime_contracts: &Value,
    field_name: &str,
) -> Vec<String> {
    let mut values = Vec::new();
    collect_unique_snapshot_strings_into(modality_runtime_contracts, field_name, &mut values);
    values
}

fn collect_unique_snapshot_strings_into(
    modality_runtime_contracts: &Value,
    field_name: &str,
    values: &mut Vec<String>,
) {
    for snapshot in modality_contract_snapshots(modality_runtime_contracts) {
        if let Some(value) = snapshot
            .get(field_name)
            .and_then(Value::as_str)
            .and_then(|value| normalize_optional_text(Some(value.to_string())))
        {
            push_unique_owned_tag(values, value);
        }
    }
}

fn collect_unique_string_array_at_pointer(value: &Value, pointer: &str, values: &mut Vec<String>) {
    if let Some(items) = value.pointer(pointer).and_then(Value::as_array) {
        for item in items {
            if let Some(value) = item
                .as_str()
                .and_then(|value| normalize_optional_text(Some(value.to_string())))
            {
                push_unique_owned_tag(values, value);
            }
        }
    }
}

fn collect_unique_string_array_fields(
    value: &Value,
    field_names: &[&str],
    values: &mut Vec<String>,
) {
    for field_name in field_names {
        if let Some(items) = value.get(*field_name).and_then(Value::as_array) {
            for item in items {
                if let Some(value) = item
                    .as_str()
                    .and_then(|value| normalize_optional_text(Some(value.to_string())))
                {
                    push_unique_owned_tag(values, value);
                }
            }
        }
    }
}

fn collect_unique_string_fields(value: &Value, field_names: &[&str], values: &mut Vec<String>) {
    for field_name in field_names {
        if let Some(value) = value
            .get(*field_name)
            .and_then(Value::as_str)
            .and_then(|value| normalize_optional_text(Some(value.to_string())))
        {
            push_unique_owned_tag(values, value);
        }
    }
}

fn format_text_list(values: &[String], fallback: &str) -> String {
    if values.is_empty() {
        fallback.to_string()
    } else {
        values
            .iter()
            .map(|value| format!("`{value}`"))
            .collect::<Vec<_>>()
            .join("、")
    }
}

fn push_unique_text_tag(values: &mut Vec<String>, value: &str) {
    if !values.iter().any(|item| item == value) {
        values.push(value.to_string());
    }
}

fn push_unique_owned_tag(values: &mut Vec<String>, value: String) {
    if !values.iter().any(|item| item == &value) {
        values.push(value);
    }
}

fn collect_latest_plan(detail: &SessionDetail) -> Option<String> {
    detail
        .items
        .iter()
        .rev()
        .find_map(|item| match &item.payload {
            AgentThreadItemPayload::Plan { text } => normalize_optional_text(Some(text.clone())),
            _ => None,
        })
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

fn collect_recent_artifact_paths(detail: &SessionDetail) -> Vec<String> {
    detail
        .items
        .iter()
        .rev()
        .filter_map(|item| match &item.payload {
            AgentThreadItemPayload::FileArtifact { path, .. } => {
                normalize_optional_text(Some(path.clone()))
            }
            _ => None,
        })
        .take(MAX_RECENT_ARTIFACTS)
        .collect()
}

fn collect_recent_timeline_items(detail: &SessionDetail) -> Vec<ReplayTimelineItem> {
    let mut items = detail
        .items
        .iter()
        .rev()
        .take(MAX_RECENT_TIMELINE_ITEMS)
        .map(|item| ReplayTimelineItem {
            item_id: item.id.clone(),
            turn_id: item.turn_id.clone(),
            payload_kind: item.payload.kind().to_string(),
            status: item.status.as_str().to_string(),
            summary: summarize_item_payload(&item.payload),
            updated_at: item.updated_at.clone(),
        })
        .collect::<Vec<_>>();
    items.reverse();
    items
}

fn collect_pending_request_inputs(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
) -> Vec<ReplayPendingRequestInput> {
    thread_read
        .pending_requests
        .iter()
        .take(MAX_PENDING_REQUESTS)
        .map(|request| {
            detail
                .items
                .iter()
                .rev()
                .find_map(|item| match &item.payload {
                    AgentThreadItemPayload::ApprovalRequest {
                        request_id,
                        action_type,
                        prompt,
                        tool_name,
                        arguments,
                        ..
                    } if request_id == &request.id => Some(ReplayPendingRequestInput {
                        request_id: request_id.clone(),
                        request_type: request.request_type.clone(),
                        title: normalize_optional_text(request.title.clone()),
                        action_type: normalize_optional_text(Some(action_type.clone())),
                        prompt: normalize_optional_text(prompt.clone()),
                        tool_name: normalize_optional_text(tool_name.clone()),
                        arguments: arguments.clone(),
                        questions: None,
                    }),
                    AgentThreadItemPayload::RequestUserInput {
                        request_id,
                        action_type,
                        prompt,
                        questions,
                        ..
                    } if request_id == &request.id => Some(ReplayPendingRequestInput {
                        request_id: request_id.clone(),
                        request_type: request.request_type.clone(),
                        title: normalize_optional_text(request.title.clone()),
                        action_type: normalize_optional_text(Some(action_type.clone())),
                        prompt: normalize_optional_text(prompt.clone()),
                        tool_name: None,
                        arguments: None,
                        questions: questions
                            .as_ref()
                            .and_then(|value| serde_json::to_value(value).ok()),
                    }),
                    _ => None,
                })
                .unwrap_or_else(|| ReplayPendingRequestInput {
                    request_id: request.id.clone(),
                    request_type: request.request_type.clone(),
                    title: normalize_optional_text(request.title.clone()),
                    action_type: None,
                    prompt: None,
                    tool_name: None,
                    arguments: None,
                    questions: None,
                })
        })
        .collect()
}

fn summarize_item_payload(payload: &AgentThreadItemPayload) -> Option<String> {
    match payload {
        AgentThreadItemPayload::Plan { text }
        | AgentThreadItemPayload::TurnSummary { text }
        | AgentThreadItemPayload::AgentMessage { text, .. }
        | AgentThreadItemPayload::Reasoning { text, .. } => {
            normalize_optional_text(Some(truncate_text(text, 160)))
        }
        AgentThreadItemPayload::FileArtifact { path, .. } => {
            normalize_optional_text(Some(path.clone()))
        }
        AgentThreadItemPayload::ApprovalRequest {
            prompt, tool_name, ..
        } => normalize_optional_text(prompt.clone().or_else(|| tool_name.clone())),
        AgentThreadItemPayload::RequestUserInput { prompt, .. } => {
            normalize_optional_text(prompt.clone())
        }
        AgentThreadItemPayload::ToolCall {
            tool_name, success, ..
        } => Some(format!(
            "{tool_name} ({})",
            if success.unwrap_or(false) {
                "success"
            } else {
                "unknown"
            }
        )),
        AgentThreadItemPayload::CommandExecution {
            command, exit_code, ..
        } => Some(format!(
            "{command} ({})",
            exit_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "running".to_string())
        )),
        AgentThreadItemPayload::WebSearch { query, action, .. } => {
            normalize_optional_text(query.clone().or_else(|| action.clone()))
        }
        AgentThreadItemPayload::SubagentActivity { title, summary, .. } => {
            normalize_optional_text(title.clone().or_else(|| summary.clone()))
        }
        AgentThreadItemPayload::Warning { message, .. }
        | AgentThreadItemPayload::Error { message } => {
            normalize_optional_text(Some(truncate_text(message, 160)))
        }
        AgentThreadItemPayload::ContextCompaction {
            detail, trigger, ..
        } => normalize_optional_text(detail.clone().or_else(|| trigger.clone())),
        AgentThreadItemPayload::UserMessage { content } => {
            normalize_optional_text(Some(truncate_text(content, 160)))
        }
    }
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn pending_request_like_state(thread_read: &AgentRuntimeThreadReadModel) -> bool {
    !thread_read.pending_requests.is_empty()
        || thread_read
            .diagnostics
            .as_ref()
            .and_then(|value| value.primary_blocking_kind.as_ref())
            .is_some_and(|value| value == "pending_request")
}

fn child_subagent_runtime_status_label(
    status: &crate::agent::ChildSubagentRuntimeStatus,
) -> &'static str {
    match status {
        crate::agent::ChildSubagentRuntimeStatus::Idle => "idle",
        crate::agent::ChildSubagentRuntimeStatus::Queued => "queued",
        crate::agent::ChildSubagentRuntimeStatus::Running => "running",
        crate::agent::ChildSubagentRuntimeStatus::Completed => "completed",
        crate::agent::ChildSubagentRuntimeStatus::Failed => "failed",
        crate::agent::ChildSubagentRuntimeStatus::Aborted => "aborted",
        crate::agent::ChildSubagentRuntimeStatus::Closed => "closed",
    }
}

fn session_todo_completed(item: &lime_agent::SessionTodoItem) -> bool {
    session_todo_status_label(item) == "completed"
}

fn session_todo_status_label(item: &lime_agent::SessionTodoItem) -> String {
    serde_json::to_value(&item.status)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "pending".to_string())
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
        AgentRequestOption, AgentRequestQuestion, AgentThreadItem, AgentThreadItemPayload,
        AgentThreadItemStatus, AgentThreadTurn, AgentThreadTurnStatus,
    };
    use tempfile::TempDir;

    fn build_detail() -> SessionDetail {
        SessionDetail {
            id: "session-1".to_string(),
            name: "P3 replay".to_string(),
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
                prompt_text: "继续把真实失败样本沉淀成 replay case".to_string(),
                status: AgentThreadTurnStatus::Completed,
                started_at: "2026-03-27T10:00:00Z".to_string(),
                completed_at: Some("2026-03-27T10:02:00Z".to_string()),
                error_message: None,
                created_at: "2026-03-27T10:00:00Z".to_string(),
                updated_at: "2026-03-27T10:02:00Z".to_string(),
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
                        text: "先复用 handoff 与 evidence，再导出 replay case".to_string(),
                    },
                },
                AgentThreadItem {
                    id: "request-1".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    sequence: 2,
                    status: AgentThreadItemStatus::InProgress,
                    started_at: "2026-03-27T10:00:20Z".to_string(),
                    completed_at: None,
                    updated_at: "2026-03-27T10:00:20Z".to_string(),
                    payload: AgentThreadItemPayload::RequestUserInput {
                        request_id: "req-1".to_string(),
                        action_type: "ask_user".to_string(),
                        prompt: Some("请选择这条 replay case 的优先级".to_string()),
                        questions: Some(vec![AgentRequestQuestion {
                            question: "优先级是 P1 还是 P2？".to_string(),
                            header: Some("优先级".to_string()),
                            options: Some(vec![
                                AgentRequestOption {
                                    label: "P1".to_string(),
                                    description: Some("进入主线".to_string()),
                                },
                                AgentRequestOption {
                                    label: "P2".to_string(),
                                    description: Some("后续补".to_string()),
                                },
                            ]),
                            multi_select: Some(false),
                        }]),
                        response: None,
                    },
                },
                AgentThreadItem {
                    id: "artifact-1".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    sequence: 3,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-27T10:01:00Z".to_string(),
                    completed_at: Some("2026-03-27T10:01:00Z".to_string()),
                    updated_at: "2026-03-27T10:01:00Z".to_string(),
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
                    sequence: 4,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-27T10:01:30Z".to_string(),
                    completed_at: Some("2026-03-27T10:01:30Z".to_string()),
                    updated_at: "2026-03-27T10:01:30Z".to_string(),
                    payload: AgentThreadItemPayload::TurnSummary {
                        text: "已完成 handoff 与 evidence，下一步把真实案例沉淀成 replay case。"
                            .to_string(),
                    },
                },
            ],
            todo_items: vec![lime_agent::SessionTodoItem {
                content: "补 replay UI 入口".to_string(),
                status: serde_json::from_value(json!("in_progress")).expect("status"),
                active_form: None,
            }],
            child_subagent_sessions: vec![crate::agent::ChildSubagentSession {
                id: "sub-1".to_string(),
                name: "Eval Reviewer".to_string(),
                created_at: 1,
                updated_at: 2,
                session_type: "subagent".to_string(),
                model: None,
                provider_name: None,
                working_dir: None,
                workspace_id: None,
                task_summary: Some("复查 replay case 是否可评分".to_string()),
                role_hint: Some("reviewer".to_string()),
                origin_tool: None,
                created_from_turn_id: None,
                blueprint_role_id: None,
                blueprint_role_label: None,
                profile_id: None,
                profile_name: None,
                role_key: None,
                team_preset_id: None,
                theme: None,
                output_contract: None,
                skill_ids: Vec::new(),
                skills: Vec::new(),
                runtime_status: Some(crate::agent::ChildSubagentRuntimeStatus::Running),
                latest_turn_status: None,
                queued_turn_count: 0,
                team_phase: None,
                team_parallel_budget: None,
                team_active_count: None,
                team_queued_count: None,
                provider_concurrency_group: None,
                provider_parallel_budget: None,
                queue_reason: None,
                retryable_overload: false,
            }],
            subagent_parent_context: None,
        }
    }

    fn build_thread_read() -> AgentRuntimeThreadReadModel {
        AgentRuntimeThreadReadModel {
            thread_id: "thread-1".to_string(),
            status: "waiting_request".to_string(),
            active_turn_id: Some("turn-1".to_string()),
            pending_requests: vec![crate::commands::aster_agent_cmd::AgentRuntimeRequestView {
                id: "req-1".to_string(),
                thread_id: "thread-1".to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: Some("request-1".to_string()),
                request_type: "ask_user".to_string(),
                status: "pending".to_string(),
                title: Some("确认 replay 样本优先级".to_string()),
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
                message_preview: "继续补 replay UI".to_string(),
                message_text: "继续补 replay UI".to_string(),
                created_at: 3,
                image_count: 0,
                position: 1,
            }],
            interrupt_state: None,
            updated_at: Some("2026-03-27T10:02:00Z".to_string()),
            latest_compaction_boundary: None,
            file_checkpoint_summary: None,
            diagnostics: Some(crate::commands::aster_agent_cmd::AgentRuntimeThreadDiagnostics {
                latest_turn_status: Some("completed".to_string()),
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
                warning_count: 0,
                context_compaction_count: 0,
                failed_tool_call_count: 0,
                failed_command_count: 0,
                pending_request_count: 1,
                oldest_pending_request_wait_seconds: None,
                primary_blocking_kind: Some("pending_request".to_string()),
                primary_blocking_summary: Some("等待用户确认 replay 样本优先级".to_string()),
                latest_warning: None,
                latest_context_compaction: None,
                latest_failed_tool: None,
                latest_failed_command: None,
                latest_pending_request: Some(
                    crate::commands::aster_agent_cmd::AgentRuntimeDiagnosticPendingRequestSample {
                        request_id: "req-1".to_string(),
                        turn_id: Some("turn-1".to_string()),
                        request_type: "ask_user".to_string(),
                        title: Some("确认 replay 样本优先级".to_string()),
                        waited_seconds: Some(15),
                        created_at: None,
                    },
                ),
            }),
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
            fallback_chain: Some(vec!["openai:gpt-5.4".to_string(), "openai:gpt-5.4-mini".to_string()]),
            auxiliary_task_runtime: Some(vec![json!({"route": "auxiliary.generate_title", "taskKind": "generation_topic"})]),
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

    #[test]
    fn replay_blocking_checks_should_treat_denied_permission_confirmation_as_blocking() {
        let mut thread_read = build_thread_read();
        thread_read.pending_requests.clear();
        thread_read.queued_turns.clear();
        thread_read.diagnostics = None;
        let mut permission_state = thread_read
            .permission_state
            .clone()
            .expect("permission state");
        permission_state.confirmation_status = Some("denied".to_string());
        permission_state.confirmation_request_id = Some("approval-denied".to_string());
        permission_state.confirmation_source = Some("runtime_action_required".to_string());
        thread_read.permission_state = Some(permission_state);

        let checks = build_blocking_checks(&thread_read, &[], &json!({}));

        assert!(checks
            .iter()
            .any(|check| check.contains("运行时权限确认已被拒绝")));
        assert!(checks.iter().any(|check| check.contains("approval-denied")));
        assert!(!checks
            .iter()
            .any(|check| check.contains("运行时权限声明仍需确认")));
    }

    #[test]
    fn replay_blocking_checks_should_treat_not_requested_permission_confirmation_as_blocking() {
        let mut thread_read = build_thread_read();
        thread_read.pending_requests.clear();
        thread_read.queued_turns.clear();
        thread_read.diagnostics = None;

        let checks = build_blocking_checks(&thread_read, &[], &json!({}));

        assert!(checks
            .iter()
            .any(|check| check.contains("运行时权限声明仍需确认")));
        assert!(checks.iter().any(|check| check.contains("read_files")));
        assert!(checks.iter().any(|check| check.contains("write_artifacts")));
        assert!(!checks
            .iter()
            .any(|check| check.contains("运行时权限确认已被拒绝")));
    }

    #[test]
    fn replay_blocking_checks_should_not_block_resolved_permission_confirmation() {
        let mut thread_read = build_thread_read();
        thread_read.pending_requests.clear();
        thread_read.queued_turns.clear();
        thread_read.diagnostics = None;
        let mut permission_state = thread_read
            .permission_state
            .clone()
            .expect("permission state");
        permission_state.confirmation_status = Some("resolved".to_string());
        permission_state.confirmation_request_id = Some("approval-resolved".to_string());
        permission_state.confirmation_source = Some("runtime_action_required".to_string());
        thread_read.permission_state = Some(permission_state);

        let checks = build_blocking_checks(&thread_read, &[], &json!({}));

        assert!(!checks
            .iter()
            .any(|check| check.contains("运行时权限声明仍需确认")));
        assert!(!checks
            .iter()
            .any(|check| check.contains("运行时权限确认已被拒绝")));
    }

    #[test]
    fn replay_blocking_checks_should_treat_user_locked_capability_gap_as_blocking() {
        let mut thread_read = build_thread_read();
        thread_read.pending_requests.clear();
        thread_read.queued_turns.clear();
        thread_read.diagnostics = None;
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

        let checks = build_blocking_checks(&thread_read, &[], &json!({}));

        assert!(checks
            .iter()
            .any(|check| check.contains("显式用户模型锁定")));
        assert!(checks
            .iter()
            .any(|check| check.contains("browser_reasoning_candidate_missing")));
        assert!(checks.iter().any(|check| check.contains("不能判 PASS")));
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
                    "modality_contract_key": "image_generation",
                    "modality": "image",
                    "required_capabilities": ["text_generation", "image_generation", "vision_input"],
                    "routing_slot": "image_generation_model",
                    "runtime_contract": {
                        "contract_key": "image_generation",
                        "modality": "image",
                        "required_capabilities": ["text_generation", "image_generation", "vision_input"],
                        "routing_slot": "image_generation_model",
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

    fn write_audio_contract_task_fixture(root: &Path, relative_path: &str) {
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
                    "routing_slot": "voice_generation_model",
                    "runtime_contract": {
                        "contract_key": VOICE_GENERATION_CONTRACT_KEY,
                        "modality": "audio",
                        "required_capabilities": ["text_generation", "voice_generation"],
                        "routing_slot": "voice_generation_model",
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

    #[test]
    fn should_export_runtime_replay_case_to_workspace() {
        let temp_dir = TempDir::new().expect("temp dir");
        let detail = build_detail();
        let thread_read = build_thread_read();

        let result =
            export_runtime_replay_case(&detail, &thread_read, temp_dir.path()).expect("export");

        assert_eq!(
            result.replay_relative_root,
            ".lime/harness/sessions/session-1/replay"
        );
        assert_eq!(result.artifacts.len(), 4);
        assert_eq!(result.linked_handoff_artifact_count, 4);
        assert_eq!(result.linked_evidence_artifact_count, 4);
        assert_eq!(result.pending_request_count, 1);
        assert_eq!(result.queued_turn_count, 1);
        assert_eq!(result.recent_artifact_count, 1);

        let input_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/input.json");
        let expected_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/expected.json");
        let grader_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/grader.md");
        let links_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/evidence-links.json");

        assert!(input_path.exists());
        assert!(expected_path.exists());
        assert!(grader_path.exists());
        assert!(links_path.exists());
        assert!(temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/handoff.md")
            .exists());
        assert!(temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/evidence/summary.md")
            .exists());

        let input = fs::read_to_string(input_path).expect("input");
        assert!(input.contains(
            "\"goalSummary\": \"已完成 handoff 与 evidence，下一步把真实案例沉淀成 replay case。\""
        ));
        assert!(input.contains("\"requestId\": \"req-1\""));
        assert!(input.contains("\"recentArtifacts\""));
        assert!(input.contains("\"fileCheckpointCount\": 1"));
        assert!(input.contains("\"fileCheckpoints\""));
        assert!(input.contains("\"checkpoint_id\": \"artifact-1\""));
        assert!(input.contains("\"path\": \".lime/artifacts/thread-1/report.md\""));
        assert!(input.contains("\"classification\""));
        assert!(input.contains("\"suiteTags\""));
        assert!(input.contains("\"failureModes\""));
        assert!(input.contains("\"pending_request\""));
        assert!(input.contains("\"observability\""));
        assert!(input.contains("\"requestTelemetry\""));
        assert!(input.contains("\"permissionState\""));
        assert!(input.contains("\"requires_confirmation\""));
        assert!(!input.contains("\"artifactValidator\""));

        let expected = fs::read_to_string(expected_path).expect("expected");
        assert!(expected.contains("不要要求与原始会话完全相同的工具调用顺序"));
        assert!(expected.contains("等待用户确认 replay 样本优先级"));
        assert!(expected.contains("运行时权限声明仍需确认"));
        assert!(expected.contains("read_files"));

        let grader = fs::read_to_string(grader_path).expect("grader");
        assert!(grader.contains("只评结果，不评路径"));
        assert!(grader.contains("verdict: pass | fail | needs_review"));

        let links = fs::read_to_string(links_path).expect("links");
        assert!(links.contains("\"handoffBundle\""));
        assert!(links.contains("\"evidencePack\""));
        assert!(links.contains("\"observabilitySummary\""));
        assert!(!links.contains("\"artifactValidator\""));
    }

    #[test]
    fn should_carry_modality_runtime_contract_into_replay_case() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();
        let image_task_relative_path = ".lime/tasks/image_generate/task-image-failed.json";

        write_failed_image_contract_task_fixture(temp_dir.path(), image_task_relative_path);
        if let AgentThreadItemPayload::FileArtifact { path, metadata, .. } =
            &mut detail.items[2].payload
        {
            *path = image_task_relative_path.to_string();
            *metadata = Some(json!({
                "task_type": "image_generate"
            }));
        }

        export_runtime_replay_case(&detail, &thread_read, temp_dir.path()).expect("export");

        let input_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/input.json");
        let expected_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/expected.json");
        let grader_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/grader.md");
        let links_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/evidence-links.json");

        let input =
            serde_json::from_str::<Value>(fs::read_to_string(input_path).expect("input").as_str())
                .expect("parse input");
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshotCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("routing_not_possible")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/missingInputs/0",
                )
                .and_then(Value::as_str),
            Some("model_catalog")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/items/0/decisionSource",
                )
                .and_then(Value::as_str),
            Some("local_default_policy")
        );
        let suite_tags = input
            .pointer("/classification/suiteTags")
            .and_then(Value::as_array)
            .expect("suite tags");
        assert!(suite_tags
            .iter()
            .any(|item| item.as_str() == Some("modality-runtime-contract")));
        assert!(suite_tags
            .iter()
            .any(|item| item.as_str() == Some("modality-image_generation")));
        assert!(suite_tags
            .iter()
            .any(|item| item.as_str() == Some("limecore-policy")));
        assert!(suite_tags
            .iter()
            .any(|item| item.as_str() == Some("limecore-policy-gap")));
        assert!(suite_tags
            .iter()
            .any(|item| item.as_str() == Some("limecore-local-default-policy")));
        let failure_modes = input
            .pointer("/classification/failureModes")
            .and_then(Value::as_array)
            .expect("failure modes");
        assert!(failure_modes
            .iter()
            .any(|item| item.as_str() == Some("modality_contract_routing_blocked")));
        assert!(failure_modes
            .iter()
            .any(|item| item.as_str() == Some("image_generation_model_capability_gap")));
        assert!(failure_modes
            .iter()
            .any(|item| item.as_str() == Some("limecore_policy_missing_inputs")));
        assert!(failure_modes
            .iter()
            .any(|item| item.as_str() == Some("limecore_policy_local_defaults_only")));

        let expected = fs::read_to_string(expected_path).expect("expected");
        assert!(expected.contains("\"modalityContractChecks\""));
        assert!(expected.contains("image_generation_model_capability_gap"));
        assert!(expected.contains("model_registry"));
        assert!(expected.contains("limecorePolicyIndex"));
        assert!(expected.contains("model_catalog"));
        assert!(expected.contains("本地默认 allow"));
        assert!(expected.contains("\"requiresHumanReview\": true"));

        let grader = fs::read_to_string(grader_path).expect("grader");
        assert!(grader.contains("多模态运行合同检查"));
        assert!(grader.contains("routing_not_possible"));
        assert!(grader.contains("limecorePolicyIndex"));
        assert!(grader.contains("missing inputs"));
        assert!(grader.contains("local_default_policy"));

        let links =
            serde_json::from_str::<Value>(fs::read_to_string(links_path).expect("links").as_str())
                .expect("parse links");
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshots/0/failureCode")
                .and_then(Value::as_str),
            Some("image_generation_model_capability_gap")
        );
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshotIndex/limecorePolicyIndex/refKeys/0")
                .and_then(Value::as_str),
            Some("model_catalog")
        );
    }

    #[test]
    fn should_carry_browser_control_contract_into_replay_grader_checks() {
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
                    "skill_id": "browser_assist",
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
                    "routing_slot": "browser_reasoning_model",
                    "runtime_contract": {
                        "contract_key": BROWSER_CONTROL_CONTRACT_KEY,
                        "routing_slot": "browser_reasoning_model",
                        "executor_binding": {
                            "executor_kind": "browser_action",
                            "binding_key": "lime_browser_mcp"
                        }
                    },
                    "entry_source": "at_browser_command",
                    "action": "navigate",
                    "selected_backend": "cdp_direct",
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

        export_runtime_replay_case(&detail, &thread_read, temp_dir.path()).expect("export");

        let input_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/input.json");
        let expected_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/expected.json");
        let grader_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/grader.md");
        let links_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/evidence-links.json");

        let input =
            serde_json::from_str::<Value>(fs::read_to_string(input_path).expect("input").as_str())
                .expect("parse input");
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(BROWSER_CONTROL_CONTRACT_KEY)
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("browser_action_requested")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/browserActionIndex/actionCount"
                )
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/browserActionIndex/items/0/sessionId"
                )
                .and_then(Value::as_str),
            Some("browser-session-1")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/taskIndex/threadIds/0"
                )
                .and_then(Value::as_str),
            Some("thread-1")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/taskIndex/contentIds/0"
                )
                .and_then(Value::as_str),
            Some("content-browser-1")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/taskIndex/entryKeys/0"
                )
                .and_then(Value::as_str),
            Some("at_browser_command")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/taskIndex/costStates/0"
                )
                .and_then(Value::as_str),
            Some("estimated")
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/runtimeFacts/modalityTaskIndex/executorBindingKeys/0")
                .and_then(Value::as_str),
            Some("lime_browser_mcp")
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/runtimeFacts/modalityTaskIndex/quotaLowCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        let suite_tags = input
            .pointer("/classification/suiteTags")
            .and_then(Value::as_array)
            .expect("suite tags");
        for expected_tag in [
            "modality-browser_control",
            "browser-control",
            "browser-assist",
            "browser-action-trace",
            "browser-action-index",
            "modality-task-index",
            "modality-task-identity",
            "modality-task-cost-limit",
        ] {
            assert!(suite_tags
                .iter()
                .any(|item| item.as_str() == Some(expected_tag)));
        }

        let expected = fs::read_to_string(expected_path).expect("expected");
        assert!(expected.contains("Browser Assist"));
        assert!(expected.contains("mcp__lime-browser__*"));
        assert!(expected.contains("WebSearch"));
        assert!(expected.contains("browser_action_trace"));
        assert!(expected.contains("browserActionIndex"));
        assert!(expected.contains("snapshotIndex.taskIndex"));
        assert!(expected.contains("thread-1"));
        assert!(expected.contains("estimated"));
        assert!(expected.contains("\"requiresHumanReview\": false"));

        let grader = fs::read_to_string(grader_path).expect("grader");
        assert!(grader.contains("多模态运行合同检查"));
        assert!(grader.contains("browser_action_requested"));
        assert!(grader.contains("browserActionIndex"));
        assert!(grader.contains("snapshotIndex.taskIndex"));
        assert!(grader.contains("at_browser_command"));
        assert!(grader.contains("within_limit"));
        assert!(grader.contains("WebSearch"));

        let links =
            serde_json::from_str::<Value>(fs::read_to_string(links_path).expect("links").as_str())
                .expect("parse links");
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("browser_action_trace.modality_runtime_contract")
        );
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshotIndex/browserActionIndex/lastUrl")
                .and_then(Value::as_str),
            Some("https://example.com/")
        );
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshotIndex/taskIndex/modelIds/0")
                .and_then(Value::as_str),
            Some("gpt-5.2-browser")
        );
    }

    #[test]
    fn should_carry_pdf_extract_contract_into_replay_grader_checks() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "pdf-contract-skill-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 5,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:01:40Z".to_string(),
            completed_at: Some("2026-03-27T10:01:40Z".to_string()),
            updated_at: "2026-03-27T10:01:40Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "Skill".to_string(),
                arguments: Some(json!({
                    "skill": "pdf_read",
                    "args": "{\"pdf_read_request\":{\"source_path\":\"/tmp/agent-report.pdf\"}}"
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
                    "routing_slot": "base_model",
                    "runtime_contract": {
                        "contract_key": PDF_EXTRACT_CONTRACT_KEY,
                        "routing_slot": "base_model",
                        "executor_binding": {
                            "executor_kind": "skill",
                            "binding_key": "pdf_read"
                        }
                    },
                    "entry_source": "at_pdf_read_command"
                })),
            },
        });

        export_runtime_replay_case(&detail, &thread_read, temp_dir.path()).expect("export");

        let input_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/input.json");
        let expected_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/expected.json");
        let grader_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/grader.md");
        let links_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/evidence-links.json");

        let input =
            serde_json::from_str::<Value>(fs::read_to_string(input_path).expect("input").as_str())
                .expect("parse input");
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(PDF_EXTRACT_CONTRACT_KEY)
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("executor_invoked")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/traceCount",
                )
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/toolTraceIndex/items/0/executorBindingKey",
                )
                .and_then(Value::as_str),
            Some("pdf_read")
        );
        let suite_tags = input
            .pointer("/classification/suiteTags")
            .and_then(Value::as_array)
            .expect("suite tags");
        for expected_tag in [
            "modality-pdf_extract",
            "pdf-extract",
            "pdf-read-skill",
            "pdf-read-trace",
        ] {
            assert!(suite_tags
                .iter()
                .any(|item| item.as_str() == Some(expected_tag)));
        }

        let expected = fs::read_to_string(expected_path).expect("expected");
        assert!(expected.contains("Skill(pdf_read)"));
        assert!(expected.contains("list_directory"));
        assert!(expected.contains("read_file"));
        assert!(expected.contains("frontend_direct_pdf_parse"));
        assert!(expected.contains("generic_chat_summary_only"));
        assert!(expected.contains("WebSearch"));
        assert!(expected.contains("\"requiresHumanReview\": false"));

        let grader = fs::read_to_string(grader_path).expect("grader");
        assert!(grader.contains("多模态运行合同检查"));
        assert!(grader.contains("Skill(pdf_read)"));
        assert!(grader.contains("frontend_direct_pdf_parse"));
        assert!(grader.contains("generic_chat_summary_only"));

        let links =
            serde_json::from_str::<Value>(fs::read_to_string(links_path).expect("links").as_str())
                .expect("parse links");
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("pdf_read_skill_trace.modality_runtime_contract")
        );
    }

    #[test]
    fn should_carry_voice_generation_contract_into_replay_grader_checks() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "voice-contract-service-scene-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 5,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:01:40Z".to_string(),
            completed_at: Some("2026-03-27T10:01:40Z".to_string()),
            updated_at: "2026-03-27T10:01:40Z".to_string(),
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
                            "modality_contract_key": VOICE_GENERATION_CONTRACT_KEY,
                            "modality": "audio",
                            "required_capabilities": [
                                "text_generation",
                                "voice_generation"
                            ],
                            "routing_slot": "voice_generation_model",
                            "runtime_contract": {
                                "contract_key": VOICE_GENERATION_CONTRACT_KEY,
                                "routing_slot": "voice_generation_model",
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

        export_runtime_replay_case(&detail, &thread_read, temp_dir.path()).expect("export");

        let input_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/input.json");
        let expected_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/expected.json");
        let grader_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/grader.md");
        let links_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/evidence-links.json");

        let input =
            serde_json::from_str::<Value>(fs::read_to_string(input_path).expect("input").as_str())
                .expect("parse input");
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(VOICE_GENERATION_CONTRACT_KEY)
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("voice_generation_service_scene_trace.modality_runtime_contract")
        );
        let suite_tags = input
            .pointer("/classification/suiteTags")
            .and_then(Value::as_array)
            .expect("suite tags");
        for expected_tag in [
            "modality-voice_generation",
            "voice-generation",
            "voice-runtime",
            "voice-generation-trace",
        ] {
            assert!(suite_tags
                .iter()
                .any(|item| item.as_str() == Some(expected_tag)));
        }

        let expected = fs::read_to_string(expected_path).expect("expected");
        assert!(expected.contains("service_scene_launch(scene_key=voice_runtime)"));
        assert!(expected.contains("ServiceSkill runtime"));
        assert!(expected.contains("legacy_tts_test_command"));
        assert!(expected.contains("fake_cloud_scene_submitted"));
        assert!(expected.contains("audio_task/audio_output"));
        assert!(expected.contains("\"requiresHumanReview\": false"));

        let grader = fs::read_to_string(grader_path).expect("grader");
        assert!(grader.contains("多模态运行合同检查"));
        assert!(grader.contains("voice_generation"));
        assert!(grader.contains("voice_runtime"));
        assert!(grader.contains("legacy_tts_test_command"));

        let links =
            serde_json::from_str::<Value>(fs::read_to_string(links_path).expect("links").as_str())
                .expect("parse links");
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("voice_generation_service_scene_trace.modality_runtime_contract")
        );
    }

    #[test]
    fn should_carry_voice_generation_audio_task_into_replay_grader_checks() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();
        let audio_task_relative_path = ".lime/tasks/audio_generate/task-audio-1.json";

        write_audio_contract_task_fixture(temp_dir.path(), audio_task_relative_path);
        if let AgentThreadItemPayload::FileArtifact { path, metadata, .. } =
            &mut detail.items[2].payload
        {
            *path = audio_task_relative_path.to_string();
            *metadata = Some(json!({
                "task_type": "audio_generate"
            }));
        }

        export_runtime_replay_case(&detail, &thread_read, temp_dir.path()).expect("export");

        let input_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/input.json");
        let expected_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/expected.json");
        let grader_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/grader.md");
        let links_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/evidence-links.json");

        let input =
            serde_json::from_str::<Value>(fs::read_to_string(input_path).expect("input").as_str())
                .expect("parse input");
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("audio_task.modality_runtime_contract")
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/taskType")
                .and_then(Value::as_str),
            Some("audio_generate")
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/audioOutput/status")
                .and_then(Value::as_str),
            Some("completed")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshots/0/audioOutput/audioPath"
                )
                .and_then(Value::as_str),
            Some(".lime/runtime/audio/task-audio-1.mp3")
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshotIndex/audioOutputIndex/outputCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        let suite_tags = input
            .pointer("/classification/suiteTags")
            .and_then(Value::as_array)
            .expect("suite tags");
        assert!(suite_tags
            .iter()
            .any(|item| item.as_str() == Some("voice-generation-trace")));
        assert!(suite_tags
            .iter()
            .any(|item| item.as_str() == Some("audio-output-completed")));
        let failure_modes = input
            .pointer("/classification/failureModes")
            .and_then(Value::as_array)
            .expect("failure modes");
        assert!(!failure_modes
            .iter()
            .any(|item| { item.as_str() == Some("voice_generation_missing_service_trace") }));

        let expected = fs::read_to_string(expected_path).expect("expected");
        assert!(expected.contains("audio_task/audio_output"));
        assert!(expected.contains("audio_output.completed"));
        assert!(expected.contains("\"requiresHumanReview\": false"));

        let grader = fs::read_to_string(grader_path).expect("grader");
        assert!(grader.contains("audio_output.completed"));
        assert!(grader.contains("audio_path"));

        let links =
            serde_json::from_str::<Value>(fs::read_to_string(links_path).expect("links").as_str())
                .expect("parse links");
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("audio_task.modality_runtime_contract")
        );
        assert_eq!(
            links
                .pointer(
                    "/modalityRuntimeContracts/snapshotIndex/audioOutputIndex/items/0/audioPath"
                )
                .and_then(Value::as_str),
            Some(".lime/runtime/audio/task-audio-1.mp3")
        );
    }

    #[test]
    fn should_classify_voice_audio_output_provider_failure_for_replay() {
        let detail = build_detail();
        let thread_read = build_thread_read();
        let modality_runtime_contracts = json!({
            "snapshotCount": 1,
            "snapshots": [{
                "contractKey": VOICE_GENERATION_CONTRACT_KEY,
                "source": "audio_task.modality_runtime_contract",
                "routingEvent": "executor_invoked",
                "audioOutput": {
                    "status": "failed",
                    "errorCode": "audio_provider_unconfigured",
                    "errorMessage": "未找到可用的 voice_generation provider/API Key。",
                    "retryable": true
                }
            }]
        });

        let failure_modes =
            infer_replay_failure_modes(&detail, &thread_read, &modality_runtime_contracts);
        assert!(failure_modes
            .iter()
            .any(|item| item == "voice_generation_audio_output_failed"));
        assert!(failure_modes
            .iter()
            .any(|item| item == "audio_provider_unconfigured"));

        let blocking_checks = build_blocking_checks(&thread_read, &[], &modality_runtime_contracts);
        assert!(blocking_checks
            .iter()
            .any(|item| item.contains("audio_provider_unconfigured")));

        let contract_checks = build_modality_contract_checks(&modality_runtime_contracts);
        assert!(contract_checks
            .iter()
            .any(|item| item.contains("audio_output.failed")));
        assert!(contract_checks
            .iter()
            .any(|item| item.contains("audio_provider_unconfigured")));
    }

    #[test]
    fn should_classify_audio_transcription_transcript_failure_for_replay() {
        let detail = build_detail();
        let thread_read = build_thread_read();
        let modality_runtime_contracts = json!({
            "snapshotCount": 1,
            "snapshotIndex": {
                "transcriptIndex": {
                    "transcriptCount": 1,
                    "statusCounts": [{ "status": "failed", "count": 1 }],
                    "errorCodes": ["transcription_provider_unconfigured"],
                    "items": [{
                        "status": "failed",
                        "errorCode": "transcription_provider_unconfigured"
                    }]
                }
            },
            "snapshots": [{
                "contractKey": AUDIO_TRANSCRIPTION_CONTRACT_KEY,
                "source": "transcription_task.modality_runtime_contract",
                "routingEvent": "executor_invoked",
                "transcript": {
                    "status": "failed",
                    "errorCode": "transcription_provider_unconfigured",
                    "errorMessage": "未找到可用的 audio_transcription provider/API Key。",
                    "retryable": true
                }
            }]
        });

        let failure_modes =
            infer_replay_failure_modes(&detail, &thread_read, &modality_runtime_contracts);
        assert!(failure_modes
            .iter()
            .any(|item| item == "audio_transcription_transcript_failed"));
        assert!(failure_modes
            .iter()
            .any(|item| item == "transcription_provider_unconfigured"));

        let blocking_checks = build_blocking_checks(&thread_read, &[], &modality_runtime_contracts);
        assert!(blocking_checks
            .iter()
            .any(|item| item.contains("transcription_provider_unconfigured")));
        assert!(!blocking_checks
            .iter()
            .any(|item| item.contains("缺少 `snapshotIndex.transcriptIndex`")));

        let contract_checks = build_modality_contract_checks(&modality_runtime_contracts);
        assert!(contract_checks
            .iter()
            .any(|item| item.contains("transcript.failed")));
        assert!(contract_checks
            .iter()
            .any(|item| item.contains("frontend_direct_asr")));
    }

    #[test]
    fn should_carry_web_research_contract_into_replay_grader_checks() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "web-research-contract-skill-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 5,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:01:40Z".to_string(),
            completed_at: Some("2026-03-27T10:01:40Z".to_string()),
            updated_at: "2026-03-27T10:01:40Z".to_string(),
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
                            "routing_slot": "report_generation_model",
                            "runtime_contract": {
                                "contract_key": WEB_RESEARCH_CONTRACT_KEY,
                                "routing_slot": "report_generation_model",
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

        export_runtime_replay_case(&detail, &thread_read, temp_dir.path()).expect("export");

        let input_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/input.json");
        let expected_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/expected.json");
        let grader_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/grader.md");
        let links_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/evidence-links.json");

        let input =
            serde_json::from_str::<Value>(fs::read_to_string(input_path).expect("input").as_str())
                .expect("parse input");
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(WEB_RESEARCH_CONTRACT_KEY)
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("executor_invoked")
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/executionProfileKey")
                .and_then(Value::as_str),
            Some("web_research_profile")
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/executorAdapterKey")
                .and_then(Value::as_str),
            Some("skill:research")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/executionProfileKeys/0",
                )
                .and_then(Value::as_str),
            Some("web_research_profile")
        );
        assert_eq!(
            input
                .pointer(
                    "/runtimeContext/modalityRuntimeContracts/snapshotIndex/executorAdapterKeys/0",
                )
                .and_then(Value::as_str),
            Some("skill:research")
        );
        let suite_tags = input
            .pointer("/classification/suiteTags")
            .and_then(Value::as_array)
            .expect("suite tags");
        for expected_tag in [
            "modality-web_research",
            "execution-profile",
            "executor-adapter",
            "web-research",
            "research-skill",
            "web-research-trace",
        ] {
            assert!(suite_tags
                .iter()
                .any(|item| item.as_str() == Some(expected_tag)));
        }

        let expected = fs::read_to_string(expected_path).expect("expected");
        assert!(expected.contains("Skill(research)"));
        assert!(expected.contains("Skill(site_search)"));
        assert!(expected.contains("Skill(report_generate)"));
        assert!(expected.contains("search_query"));
        assert!(expected.contains("lime_site_*"));
        assert!(expected.contains("web_research_profile"));
        assert!(expected.contains("skill:research"));
        assert!(expected.contains("model_memory_only_answer"));
        assert!(expected.contains("local_file_search_before_research_skill"));
        assert!(expected.contains("\"requiresHumanReview\": false"));

        let grader = fs::read_to_string(grader_path).expect("grader");
        assert!(grader.contains("多模态运行合同检查"));
        assert!(grader.contains("web_research_profile"));
        assert!(grader.contains("skill:research"));
        assert!(grader.contains("Skill(research)"));
        assert!(grader.contains("Skill(report_generate)"));
        assert!(grader.contains("model_memory_only_answer"));
        assert!(grader.contains("local_file_search_before_research_skill"));

        let links =
            serde_json::from_str::<Value>(fs::read_to_string(links_path).expect("links").as_str())
                .expect("parse links");
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("web_research_skill_trace.modality_runtime_contract")
        );
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshotIndex/executionProfileKeys/0")
                .and_then(Value::as_str),
            Some("web_research_profile")
        );
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshotIndex/executorAdapterKeys/0")
                .and_then(Value::as_str),
            Some("skill:research")
        );
    }

    #[test]
    fn should_carry_text_transform_contract_into_replay_grader_checks() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();

        detail.items.push(AgentThreadItem {
            id: "text-transform-contract-skill-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 5,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:01:45Z".to_string(),
            completed_at: Some("2026-03-27T10:01:45Z".to_string()),
            updated_at: "2026-03-27T10:01:45Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "Skill".to_string(),
                arguments: Some(json!({
                    "skill": "summary",
                    "args": serde_json::to_string(&json!({
                        "summary_request": {
                            "source_path": "/tmp/meeting-notes.md",
                            "instruction": "总结成三点行动项",
                            "modality_contract_key": TEXT_TRANSFORM_CONTRACT_KEY,
                            "modality": "document",
                            "required_capabilities": [
                                "text_generation",
                                "local_file_read",
                                "long_context"
                            ],
                            "routing_slot": "base_model",
                            "runtime_contract": {
                                "contract_key": TEXT_TRANSFORM_CONTRACT_KEY,
                                "routing_slot": "base_model",
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

        export_runtime_replay_case(&detail, &thread_read, temp_dir.path()).expect("export");

        let input_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/input.json");
        let expected_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/expected.json");
        let grader_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/grader.md");
        let links_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/replay/evidence-links.json");

        let input =
            serde_json::from_str::<Value>(fs::read_to_string(input_path).expect("input").as_str())
                .expect("parse input");
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/contractKey")
                .and_then(Value::as_str),
            Some(TEXT_TRANSFORM_CONTRACT_KEY)
        );
        assert_eq!(
            input
                .pointer("/runtimeContext/modalityRuntimeContracts/snapshots/0/routingEvent")
                .and_then(Value::as_str),
            Some("executor_invoked")
        );
        let suite_tags = input
            .pointer("/classification/suiteTags")
            .and_then(Value::as_array)
            .expect("suite tags");
        for expected_tag in [
            "modality-text_transform",
            "text-transform",
            "text-transform-skill",
            "text-transform-trace",
        ] {
            assert!(suite_tags
                .iter()
                .any(|item| item.as_str() == Some(expected_tag)));
        }

        let expected = fs::read_to_string(expected_path).expect("expected");
        assert!(expected.contains("Skill(summary)"));
        assert!(expected.contains("Skill(translation)"));
        assert!(expected.contains("Skill(analysis)"));
        assert!(expected.contains("list_directory"));
        assert!(expected.contains("read_file"));
        assert!(expected.contains("frontend_direct_text_transform"));
        assert!(expected.contains("tool_search_before_text_transform_skill"));
        assert!(expected.contains("web_search_before_text_transform_skill"));
        assert!(expected.contains("\"requiresHumanReview\": false"));

        let grader = fs::read_to_string(grader_path).expect("grader");
        assert!(grader.contains("多模态运行合同检查"));
        assert!(grader.contains("Skill(summary)"));
        assert!(grader.contains("Skill(translation)"));
        assert!(grader.contains("Skill(analysis)"));
        assert!(grader.contains("frontend_direct_text_transform"));

        let links =
            serde_json::from_str::<Value>(fs::read_to_string(links_path).expect("links").as_str())
                .expect("parse links");
        assert_eq!(
            links
                .pointer("/modalityRuntimeContracts/snapshots/0/source")
                .and_then(Value::as_str),
            Some("text_transform_skill_trace.modality_runtime_contract")
        );
    }
}
