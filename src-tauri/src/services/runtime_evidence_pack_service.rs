//! Runtime evidence pack 导出服务
//!
//! 将当前 Lime 会话的 runtime / timeline / artifact 事实，
//! 导出为最小可复盘的问题证据包。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use chrono::Utc;
use lime_core::database::dao::agent_timeline::AgentThreadItemPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt::Write as _;
use std::fs;
use std::path::Path;

const SESSION_RELATIVE_ROOT: &str = ".lime/harness/sessions";
const EVIDENCE_DIR_NAME: &str = "evidence";
const SUMMARY_FILE_NAME: &str = "summary.md";
const RUNTIME_FILE_NAME: &str = "runtime.json";
const TIMELINE_FILE_NAME: &str = "timeline.json";
const ARTIFACTS_FILE_NAME: &str = "artifacts.json";
const MAX_RECENT_ARTIFACTS: usize = 12;
const MAX_PREVIEW_CHARS: usize = 200;

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

    let recent_artifacts = collect_recent_artifact_paths(detail);
    let latest_turn_summary = collect_latest_turn_summary(detail);
    let known_gaps = build_known_gaps(&recent_artifacts);
    let observability_summary = build_runtime_observability_summary_json(
        detail,
        thread_read,
        &recent_artifacts,
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
                &recent_artifacts,
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
                &recent_artifacts,
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
                &recent_artifacts,
                &observability_summary,
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
        recent_artifact_count: recent_artifacts.len(),
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
    known_gaps: &[String],
    exported_at: &str,
) -> Result<String, String> {
    let payload = json!({
        "schemaVersion": "v1",
        "exportedAt": exported_at,
        "recentArtifacts": recent_artifacts,
        "artifactCount": recent_artifacts.len(),
        "observabilitySummary": observability_summary,
        "verification": {
            "artifactValidatorIssues": [],
            "browserEvidence": [],
            "guiSmoke": null
        },
        "requests": {
            "pending": thread_read.pending_requests.iter().map(|item| {
                json!({
                    "id": item.id,
                    "type": item.request_type,
                    "title": item.title,
                    "status": item.status
                })
            }).collect::<Vec<_>>(),
            "knownGap": "provider request token / retry 摘要尚未接入当前 evidence pack"
        },
        "workspace": {
            "workspaceId": detail.workspace_id,
            "workingDir": detail.working_dir
        },
        "knownGaps": known_gaps
    });

    serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 artifacts.json 失败: {error}"))
}

fn build_known_gaps(recent_artifacts: &[String]) -> Vec<String> {
    let mut gaps = vec![
        "当前 Lime 虽然已有全局 RequestLog / token / retry / duration 遥测，但 RequestLog 尚未携带 session/thread/turn 关联键，Evidence Pack 只能导出 request telemetry coverage gap，不能给出精确的会话级摘要。".to_string(),
        "当前 Evidence Pack 尚未纳入 ArtifactDocument validator outcome 与修复问题摘要。".to_string(),
        "当前 Evidence Pack 尚未纳入 GUI smoke / browser 验证结果。".to_string(),
    ];

    if recent_artifacts.is_empty() {
        gaps.push("当前未检测到最近产物路径，Artifact 证据为空。".to_string());
    }

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

fn collect_recent_artifact_paths(detail: &SessionDetail) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut paths = Vec::new();

    for item in detail.items.iter().rev() {
        let Some(path) = (match &item.payload {
            AgentThreadItemPayload::FileArtifact { path, .. } => {
                normalize_optional_text(Some(path.clone()))
            }
            _ => None,
        }) else {
            continue;
        };

        if seen.insert(path.clone()) {
            paths.push(path);
        }
        if paths.len() >= MAX_RECENT_ARTIFACTS {
            break;
        }
    }

    paths
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

pub(crate) fn build_runtime_observability_summary_json(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    recent_artifacts: &[String],
    known_gaps: &[String],
) -> Value {
    let diagnostics = thread_read.diagnostics.as_ref();
    json!({
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
        "signalCoverage": [
            json!({
                "signal": "correlation",
                "status": "exported",
                "source": "runtime thread identity",
                "detail": "当前证据包已导出 session/thread/turn/pending request/subagent 关联键。"
            }),
            json!({
                "signal": "timeline",
                "status": "exported",
                "source": "timeline.json",
                "detail": "当前证据包已导出最近 turn 与 item 时间线。"
            }),
            json!({
                "signal": "warnings",
                "status": "exported",
                "source": "thread.diagnostics",
                "detail": if diagnostics.is_some() {
                    "当前证据包已导出 warning / failed tool / failed command 摘要。"
                } else {
                    "当前线程没有 diagnostics，但 warning 通道已保留在导出结构中。"
                }
            }),
            json!({
                "signal": "requestTelemetry",
                "status": "unlinked",
                "source": "lime_infra.telemetry",
                "detail": "Lime 已有 workspace 级 request telemetry，但当前 RequestLog 还未携带 session/thread/turn 元数据。"
            }),
            json!({
                "signal": "artifactValidator",
                "status": "known_gap",
                "source": "artifact_document_validator",
                "detail": "Artifact validator outcome 尚未回挂到当前 evidence pack。"
            }),
            json!({
                "signal": "browserVerification",
                "status": "known_gap",
                "source": "browser runtime",
                "detail": "浏览器截图、DOM 快照和交互验证结果尚未接入 evidence pack。"
            }),
            json!({
                "signal": "guiSmoke",
                "status": "known_gap",
                "source": "verify:gui-smoke",
                "detail": "GUI smoke 结果尚未作为结构化证据回挂当前会话。"
            })
        ],
        "knownGaps": known_gaps
    })
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

    #[test]
    fn should_export_runtime_evidence_pack_to_workspace() {
        let temp_dir = TempDir::new().expect("temp dir");
        let detail = build_detail();
        let thread_read = build_thread_read();

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
        assert!(!result.known_gaps.is_empty());

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

        let runtime = fs::read_to_string(runtime_path).expect("runtime");
        assert!(runtime.contains("\"sessionId\": \"session-1\""));
        assert!(runtime.contains("\"pendingRequestCount\": 1"));
        assert!(runtime.contains("\"observabilitySummary\""));
        assert!(runtime.contains("\"requestTelemetry\""));
        assert!(runtime.contains("\"artifactValidator\""));

        let timeline = fs::read_to_string(timeline_path).expect("timeline");
        assert!(timeline.contains("\"payloadKind\": \"plan\""));
        assert!(timeline.contains("\"status\": \"completed\""));

        let artifacts = fs::read_to_string(artifacts_path).expect("artifacts");
        assert!(artifacts.contains("\"observabilitySummary\""));
        assert!(artifacts.contains("\"guiSmoke\""));
    }
}
