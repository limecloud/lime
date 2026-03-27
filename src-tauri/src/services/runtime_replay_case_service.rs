//! Runtime replay case 导出服务
//!
//! 目标是把当前 Lime 会话沉淀为最小可复盘、可评分、可回归的 replay case。
//! 这条主链参考 Codex 的 replay fidelity 与 Aster 的 eval / bench 组织方式，
//! 但最终制品仍然落在 Lime 工作区，复用现有 handoff bundle 与 evidence pack。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use crate::services::runtime_evidence_pack_service::{
    export_runtime_evidence_pack, RuntimeEvidencePackExportResult,
};
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
    let pending_requests = collect_pending_request_inputs(detail, thread_read);
    let recent_timeline = collect_recent_timeline_items(detail);
    let success_criteria = build_success_criteria(
        detail,
        thread_read,
        goal_summary.as_deref(),
        &recent_artifacts,
        &pending_requests,
    );
    let blocking_checks = build_blocking_checks(thread_read, &pending_requests);
    let artifact_checks = build_artifact_checks(&recent_artifacts);

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
                &recent_timeline,
                &pending_requests,
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
    recent_timeline: &[ReplayTimelineItem],
    pending_requests: &[ReplayPendingRequestInput],
    workspace_root: &Path,
    exported_at: &str,
) -> Result<String, String> {
    let latest_turn = detail.turns.last();
    let suite_tags = infer_replay_suite_tags(detail, thread_read, handoff_bundle, evidence_pack);
    let failure_modes = infer_replay_failure_modes(detail, thread_read);
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
            "recentTimeline": recent_timeline,
            "lastOutcome": &thread_read.last_outcome,
            "incidents": &thread_read.incidents,
        },
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
            "requiresHumanReview": !thread_read.incidents.is_empty(),
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
        "recentArtifacts": recent_artifacts,
    });

    serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 evidence-links.json 失败: {error}"))
}

fn build_success_criteria(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    goal_summary: Option<&str>,
    recent_artifacts: &[String],
    pending_requests: &[ReplayPendingRequestInput],
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

    if criteria.is_empty() {
        criteria.push("结果应与 input.json 描述的任务目标一致。".to_string());
    }

    criteria
}

fn build_blocking_checks(
    thread_read: &AgentRuntimeThreadReadModel,
    pending_requests: &[ReplayPendingRequestInput],
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

    if checks.is_empty() {
        checks.push("当前没有额外阻塞检查项，按结果与证据判定即可。".to_string());
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

    tags
}

fn infer_replay_failure_modes(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
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

    failure_modes
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
        }
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
        assert!(input.contains("\"classification\""));
        assert!(input.contains("\"suiteTags\""));
        assert!(input.contains("\"failureModes\""));
        assert!(input.contains("\"pending_request\""));

        let expected = fs::read_to_string(expected_path).expect("expected");
        assert!(expected.contains("不要要求与原始会话完全相同的工具调用顺序"));
        assert!(expected.contains("等待用户确认 replay 样本优先级"));

        let grader = fs::read_to_string(grader_path).expect("grader");
        assert!(grader.contains("只评结果，不评路径"));
        assert!(grader.contains("verdict: pass | fail | needs_review"));

        let links = fs::read_to_string(links_path).expect("links");
        assert!(links.contains("\"handoffBundle\""));
        assert!(links.contains("\"evidencePack\""));
    }
}
