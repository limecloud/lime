//! Runtime handoff bundle 导出服务
//!
//! 将当前 Lime 会话的 runtime / timeline / queue / subagent 事实，
//! 导出为工作区内可被后续会话直接消费的交接制品。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use chrono::Utc;
use lime_core::database::dao::agent_timeline::AgentThreadItemPayload;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fmt::Write as _;
use std::fs;
use std::path::Path;

const HANDOFF_RELATIVE_ROOT: &str = ".lime/harness/sessions";
const PLAN_FILE_NAME: &str = "plan.md";
const PROGRESS_FILE_NAME: &str = "progress.json";
const HANDOFF_FILE_NAME: &str = "handoff.md";
const REVIEW_SUMMARY_FILE_NAME: &str = "review-summary.md";
const MAX_RECENT_ARTIFACTS: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeHandoffArtifactKind {
    Plan,
    Progress,
    Handoff,
    ReviewSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHandoffArtifact {
    pub kind: RuntimeHandoffArtifactKind,
    pub title: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHandoffBundleExportResult {
    pub session_id: String,
    pub thread_id: String,
    pub workspace_id: Option<String>,
    pub workspace_root: String,
    pub bundle_relative_root: String,
    pub bundle_absolute_root: String,
    pub exported_at: String,
    pub thread_status: String,
    pub latest_turn_status: Option<String>,
    pub pending_request_count: usize,
    pub queued_turn_count: usize,
    pub active_subagent_count: usize,
    pub todo_total: usize,
    pub todo_pending: usize,
    pub todo_in_progress: usize,
    pub todo_completed: usize,
    pub artifacts: Vec<RuntimeHandoffArtifact>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct TodoSummary {
    total: usize,
    pending: usize,
    in_progress: usize,
    completed: usize,
}

pub fn export_runtime_handoff_bundle(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: &Path,
) -> Result<RuntimeHandoffBundleExportResult, String> {
    let session_id = detail.id.trim();
    if session_id.is_empty() {
        return Err("session_id 不能为空，无法导出 handoff bundle".to_string());
    }

    let thread_id = detail.thread_id.trim();
    if thread_id.is_empty() {
        return Err("thread_id 不能为空，无法导出 handoff bundle".to_string());
    }

    let workspace_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let exported_at = Utc::now().to_rfc3339();
    let bundle_relative_root = format!("{HANDOFF_RELATIVE_ROOT}/{session_id}");
    let bundle_absolute_root =
        workspace_root.join(bundle_relative_root.replace('/', std::path::MAIN_SEPARATOR_STR));

    fs::create_dir_all(&bundle_absolute_root).map_err(|error| {
        format!(
            "创建 handoff bundle 目录失败 {}: {error}",
            bundle_absolute_root.display()
        )
    })?;

    let todo_summary = summarize_todos(detail);
    let recent_artifacts = collect_recent_artifact_paths(detail);
    let latest_turn_summary = collect_latest_turn_summary(detail);
    let review_actions = build_review_actions(thread_read);

    let artifacts = vec![
        write_bundle_file(
            &bundle_absolute_root,
            session_id,
            PLAN_FILE_NAME,
            RuntimeHandoffArtifactKind::Plan,
            "计划摘要",
            build_plan_markdown(
                detail,
                thread_read,
                &todo_summary,
                &recent_artifacts,
                latest_turn_summary.as_deref(),
                exported_at.as_str(),
            ),
        )?,
        write_bundle_file(
            &bundle_absolute_root,
            session_id,
            PROGRESS_FILE_NAME,
            RuntimeHandoffArtifactKind::Progress,
            "结构化进度",
            build_progress_json(
                detail,
                thread_read,
                &todo_summary,
                &recent_artifacts,
                latest_turn_summary.as_deref(),
                &review_actions,
                workspace_root.as_path(),
                exported_at.as_str(),
            )?,
        )?,
        write_bundle_file(
            &bundle_absolute_root,
            session_id,
            HANDOFF_FILE_NAME,
            RuntimeHandoffArtifactKind::Handoff,
            "交接摘要",
            build_handoff_markdown(
                detail,
                thread_read,
                &todo_summary,
                &recent_artifacts,
                latest_turn_summary.as_deref(),
                &review_actions,
                exported_at.as_str(),
            ),
        )?,
        write_bundle_file(
            &bundle_absolute_root,
            session_id,
            REVIEW_SUMMARY_FILE_NAME,
            RuntimeHandoffArtifactKind::ReviewSummary,
            "审查摘要",
            build_review_summary_markdown(
                detail,
                thread_read,
                &recent_artifacts,
                &review_actions,
                exported_at.as_str(),
            ),
        )?,
    ];

    Ok(RuntimeHandoffBundleExportResult {
        session_id: session_id.to_string(),
        thread_id: thread_id.to_string(),
        workspace_id: normalize_optional_text(detail.workspace_id.clone()),
        workspace_root: workspace_root.to_string_lossy().to_string(),
        bundle_relative_root,
        bundle_absolute_root: bundle_absolute_root.to_string_lossy().to_string(),
        exported_at,
        thread_status: thread_read.status.trim().to_string(),
        latest_turn_status: thread_read
            .diagnostics
            .as_ref()
            .and_then(|value| normalize_optional_text(value.latest_turn_status.clone())),
        pending_request_count: thread_read.pending_requests.len(),
        queued_turn_count: thread_read.queued_turns.len(),
        active_subagent_count: count_active_subagents(detail),
        todo_total: todo_summary.total,
        todo_pending: todo_summary.pending,
        todo_in_progress: todo_summary.in_progress,
        todo_completed: todo_summary.completed,
        artifacts,
    })
}

fn write_bundle_file(
    bundle_root: &Path,
    session_id: &str,
    file_name: &str,
    kind: RuntimeHandoffArtifactKind,
    title: &str,
    content: String,
) -> Result<RuntimeHandoffArtifact, String> {
    let absolute_path = bundle_root.join(file_name);
    fs::write(&absolute_path, content.as_bytes()).map_err(|error| {
        format!(
            "写入 handoff bundle 文件失败 {}: {error}",
            absolute_path.display()
        )
    })?;

    Ok(RuntimeHandoffArtifact {
        kind,
        title: title.to_string(),
        relative_path: format!("{HANDOFF_RELATIVE_ROOT}/{session_id}/{file_name}"),
        absolute_path: absolute_path.to_string_lossy().to_string(),
        bytes: content.len(),
    })
}

fn build_plan_markdown(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    todo_summary: &TodoSummary,
    recent_artifacts: &[String],
    latest_turn_summary: Option<&str>,
    exported_at: &str,
) -> String {
    let mut markdown = String::new();
    let _ = writeln!(markdown, "# 会话计划");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "> 形状参考 Codex 的 `plan / handoff` 合同，运行时事实承接 Aster 的 `session / runtime / resume`，当前工作区制品由 Lime 导出。"
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 会话：`{}`", detail.id);
    let _ = writeln!(markdown, "- 线程：`{}`", detail.thread_id);
    let _ = writeln!(markdown, "- 导出时间：{exported_at}");
    let _ = writeln!(markdown, "- 线程状态：{}", thread_read.status);
    if let Some(strategy) = normalize_optional_text(detail.execution_strategy.clone()) {
        let _ = writeln!(markdown, "- 执行策略：{strategy}");
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 当前目标");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "{}",
        latest_turn_summary
            .unwrap_or("当前没有可直接复用的 turn summary，恢复时请先阅读 handoff.md。")
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## Todo");
    let _ = writeln!(markdown);
    if detail.todo_items.is_empty() {
        let fallback_plans = collect_plan_lines(detail);
        if fallback_plans.is_empty() {
            let _ = writeln!(markdown, "- 当前没有显式 Todo 列表。");
        } else {
            for plan in fallback_plans {
                let _ = writeln!(markdown, "- {plan}");
            }
        }
    } else {
        let _ = writeln!(
            markdown,
            "- 总数：{}，待开始 {}，进行中 {}，已完成 {}",
            todo_summary.total,
            todo_summary.pending,
            todo_summary.in_progress,
            todo_summary.completed
        );
        for item in &detail.todo_items {
            let status = todo_status_value(item);
            let marker = match status.as_str() {
                "completed" => "[x]",
                "in_progress" => "[-]",
                _ => "[ ]",
            };
            if let Some(active_form) = normalize_optional_text(item.active_form.clone()) {
                let _ = writeln!(markdown, "- {marker} {} ({active_form})", item.content);
            } else {
                let _ = writeln!(markdown, "- {marker} {}", item.content);
            }
        }
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 当前阻塞");
    let _ = writeln!(markdown);
    let blocking_lines = build_blocking_lines(thread_read);
    if blocking_lines.is_empty() {
        let _ = writeln!(markdown, "- 当前未检测到显式阻塞。");
    } else {
        for line in blocking_lines {
            let _ = writeln!(markdown, "- {line}");
        }
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 运行时事实");
    let _ = writeln!(markdown);
    let runtime_fact_lines = build_runtime_fact_lines(thread_read);
    if runtime_fact_lines.is_empty() {
        let _ = writeln!(markdown, "- 当前没有可导出的任务 / 路由 / 经济事实。");
    } else {
        for line in runtime_fact_lines {
            let _ = writeln!(markdown, "- {line}");
        }
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 最近产物");
    let _ = writeln!(markdown);
    if recent_artifacts.is_empty() {
        let _ = writeln!(markdown, "- 当前未发现最近产物路径。");
    } else {
        for path in recent_artifacts {
            let _ = writeln!(markdown, "- `{path}`");
        }
    }

    markdown
}

fn build_progress_json(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    todo_summary: &TodoSummary,
    recent_artifacts: &[String],
    latest_turn_summary: Option<&str>,
    review_actions: &[String],
    workspace_root: &Path,
    exported_at: &str,
) -> Result<String, String> {
    let progress = json!({
        "schemaVersion": "v1",
        "source": {
            "contractShape": "codex_plan_handoff",
            "runtimeSubstrate": "aster_session_runtime_resume",
            "productSurface": "lime_workspace_handoff_bundle"
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
        "status": {
            "threadStatus": thread_read.status,
            "latestTurnStatus": thread_read.diagnostics.as_ref().and_then(|value| value.latest_turn_status.clone()),
            "activeTurnId": thread_read.active_turn_id,
            "pendingRequestCount": thread_read.pending_requests.len(),
            "queuedTurnCount": thread_read.queued_turns.len(),
            "interruptState": thread_read.interrupt_state
        },
        "todo": {
            "total": todo_summary.total,
            "pending": todo_summary.pending,
            "inProgress": todo_summary.in_progress,
            "completed": todo_summary.completed,
            "items": detail.todo_items.iter().map(|item| {
                json!({
                    "content": item.content,
                    "status": todo_status_value(item),
                    "activeForm": item.active_form
                })
            }).collect::<Vec<_>>()
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
                "roleHint": session.role_hint,
                "taskSummary": session.task_summary,
                "updatedAt": session.updated_at
            })
        }).collect::<Vec<_>>(),
        "artifacts": recent_artifacts,
        "latestTurnSummary": latest_turn_summary,
        "runtimeFacts": build_runtime_facts_json(thread_read),
        "diagnostics": {
            "primaryBlockingKind": thread_read.diagnostics.as_ref().and_then(|value| value.primary_blocking_kind.clone()),
            "primaryBlockingSummary": thread_read.diagnostics.as_ref().and_then(|value| value.primary_blocking_summary.clone()),
            "latestWarning": thread_read.diagnostics.as_ref().and_then(|value| {
                value.latest_warning.as_ref().map(|warning| {
                    json!({
                        "code": warning.code,
                        "message": warning.message,
                        "updatedAt": warning.updated_at
                    })
                })
            }),
            "latestFailedTool": thread_read.diagnostics.as_ref().and_then(|value| {
                value.latest_failed_tool.as_ref().map(|tool| {
                    json!({
                        "toolName": tool.tool_name,
                        "error": tool.error,
                        "updatedAt": tool.updated_at
                    })
                })
            }),
            "latestFailedCommand": thread_read.diagnostics.as_ref().and_then(|value| {
                value.latest_failed_command.as_ref().map(|command| {
                    json!({
                        "command": command.command,
                        "exitCode": command.exit_code,
                        "error": command.error,
                        "updatedAt": command.updated_at
                    })
                })
            })
        },
        "resumeOrder": build_resume_order(),
        "reviewActions": review_actions
    });

    serde_json::to_string_pretty(&progress)
        .map_err(|error| format!("序列化 progress.json 失败: {error}"))
}

fn build_handoff_markdown(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    todo_summary: &TodoSummary,
    recent_artifacts: &[String],
    latest_turn_summary: Option<&str>,
    review_actions: &[String],
    exported_at: &str,
) -> String {
    let mut markdown = String::new();
    let _ = writeln!(markdown, "# 会话交接摘要");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 会话：`{}`", detail.id);
    let _ = writeln!(markdown, "- 导出时间：{exported_at}");
    let _ = writeln!(markdown, "- 当前状态：{}", thread_read.status);
    if let Some(latest_turn_status) = thread_read
        .diagnostics
        .as_ref()
        .and_then(|value| normalize_optional_text(value.latest_turn_status.clone()))
    {
        let _ = writeln!(markdown, "- 最新 turn 状态：{latest_turn_status}");
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 最近摘要");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "{}",
        latest_turn_summary
            .unwrap_or("当前没有结构化 turn summary，请优先阅读 progress.json 与 plan.md。")
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 推荐接手顺序");
    let _ = writeln!(markdown);
    for (index, step) in build_resume_order().iter().enumerate() {
        let _ = writeln!(markdown, "{}. {}", index + 1, step);
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 当前待继续事项");
    let _ = writeln!(markdown);
    if todo_summary.total == 0 {
        let _ = writeln!(
            markdown,
            "- 当前没有 Todo 列表，请结合 review-summary.md 决定下一刀。"
        );
    } else {
        let _ = writeln!(
            markdown,
            "- Todo 总数 {}，待开始 {}，进行中 {}，已完成 {}",
            todo_summary.total,
            todo_summary.pending,
            todo_summary.in_progress,
            todo_summary.completed
        );
        for item in &detail.todo_items {
            let status = todo_status_value(item);
            if status != "completed" {
                let _ = writeln!(
                    markdown,
                    "- {}：{}",
                    todo_status_label(status.as_str()),
                    item.content
                );
            }
        }
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 运行时事实");
    let _ = writeln!(markdown);
    let runtime_fact_lines = build_runtime_fact_lines(thread_read);
    if runtime_fact_lines.is_empty() {
        let _ = writeln!(markdown, "- 当前没有可导出的任务 / 路由 / 经济事实。");
    } else {
        for line in runtime_fact_lines {
            let _ = writeln!(markdown, "- {line}");
        }
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 审查与恢复建议");
    let _ = writeln!(markdown);
    if review_actions.is_empty() {
        let _ = writeln!(markdown, "- 当前未检测到额外恢复动作。");
    } else {
        for action in review_actions {
            let _ = writeln!(markdown, "- {action}");
        }
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 最近产物");
    let _ = writeln!(markdown);
    if recent_artifacts.is_empty() {
        let _ = writeln!(markdown, "- 当前没有最近产物路径。");
    } else {
        for artifact in recent_artifacts {
            let _ = writeln!(markdown, "- `{artifact}`");
        }
    }
    if !detail.child_subagent_sessions.is_empty() {
        let _ = writeln!(markdown);
        let _ = writeln!(markdown, "## 协作成员");
        let _ = writeln!(markdown);
        for session in &detail.child_subagent_sessions {
            let status = session
                .runtime_status
                .map(subagent_status_label)
                .unwrap_or("未知");
            let summary = normalize_optional_text(session.task_summary.clone())
                .unwrap_or_else(|| "暂无任务摘要".to_string());
            let _ = writeln!(markdown, "- {} · {} · {}", session.name, status, summary);
        }
    }

    markdown
}

fn build_review_summary_markdown(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    recent_artifacts: &[String],
    review_actions: &[String],
    exported_at: &str,
) -> String {
    let mut markdown = String::new();
    let _ = writeln!(markdown, "# 审查摘要");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 会话：`{}`", detail.id);
    let _ = writeln!(markdown, "- 导出时间：{exported_at}");
    let _ = writeln!(
        markdown,
        "- 诊断结论：{}",
        if review_actions.is_empty() {
            "当前未检测到强阻塞，可继续推进"
        } else {
            "存在待处理恢复 / 审查动作"
        }
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 线程诊断");
    let _ = writeln!(markdown);
    let diagnostics = thread_read.diagnostics.as_ref();
    let _ = writeln!(markdown, "- 状态：{}", thread_read.status);
    let _ = writeln!(
        markdown,
        "- Pending request：{}",
        thread_read.pending_requests.len()
    );
    let _ = writeln!(markdown, "- Queue：{}", thread_read.queued_turns.len());
    if let Some(value) = diagnostics.and_then(|item| item.primary_blocking_summary.clone()) {
        let _ = writeln!(markdown, "- 主要阻塞：{value}");
    }
    if let Some(value) = diagnostics.and_then(|item| item.latest_warning.as_ref()) {
        let _ = writeln!(markdown, "- 最近 warning：{}", value.message);
    }
    if let Some(value) = diagnostics.and_then(|item| item.latest_failed_tool.as_ref()) {
        let _ = writeln!(
            markdown,
            "- 最近失败工具：{}{}",
            value.tool_name,
            value
                .error
                .as_ref()
                .map(|error| format!(" ({error})"))
                .unwrap_or_default()
        );
    }
    if let Some(value) = diagnostics.and_then(|item| item.latest_failed_command.as_ref()) {
        let _ = writeln!(
            markdown,
            "- 最近失败命令：{}{}",
            value.command,
            value
                .error
                .as_ref()
                .map(|error| format!(" ({error})"))
                .unwrap_or_default()
        );
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 运行时事实");
    let _ = writeln!(markdown);
    let runtime_fact_lines = build_runtime_fact_lines(thread_read);
    if runtime_fact_lines.is_empty() {
        let _ = writeln!(markdown, "- 当前没有可导出的任务 / 路由 / 经济事实。");
    } else {
        for line in runtime_fact_lines {
            let _ = writeln!(markdown, "- {line}");
        }
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 建议动作");
    let _ = writeln!(markdown);
    if review_actions.is_empty() {
        let _ = writeln!(
            markdown,
            "- 继续执行下一步实现，并在完成后刷新 handoff bundle。"
        );
    } else {
        for action in review_actions {
            let _ = writeln!(markdown, "- {action}");
        }
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 重点产物");
    let _ = writeln!(markdown);
    if recent_artifacts.is_empty() {
        let _ = writeln!(markdown, "- 当前没有可关联的文件产物。");
    } else {
        for artifact in recent_artifacts {
            let _ = writeln!(markdown, "- `{artifact}`");
        }
    }

    markdown
}

fn build_runtime_fact_lines(thread_read: &AgentRuntimeThreadReadModel) -> Vec<String> {
    let mut lines = Vec::new();

    if let Some(task_kind) = normalize_optional_text(thread_read.task_kind.clone()) {
        lines.push(format!("任务类型：{task_kind}"));
    }
    if let Some(service_model_slot) =
        normalize_optional_text(thread_read.service_model_slot.clone())
    {
        lines.push(format!("服务模型槽位：{service_model_slot}"));
    }
    if let Some(routing_mode) = normalize_optional_text(thread_read.routing_mode.clone()) {
        lines.push(format!("路由模式：{routing_mode}"));
    }
    if let Some(decision_source) = normalize_optional_text(thread_read.decision_source.clone()) {
        lines.push(format!("决策来源：{decision_source}"));
    }
    if let Some(candidate_count) = thread_read.candidate_count {
        lines.push(format!("候选数：{candidate_count}"));
    }
    if let Some(capability_gap) = normalize_optional_text(thread_read.capability_gap.clone()) {
        lines.push(format!("能力缺口：{capability_gap}"));
    }
    if let Some(decision_reason) = normalize_optional_text(thread_read.decision_reason.clone()) {
        lines.push(format!("决策解释：{decision_reason}"));
    }
    if let Some(fallback_chain) = thread_read
        .fallback_chain
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        lines.push(format!("回退链：{}", fallback_chain.join(" -> ")));
    }
    if let Some(estimated_cost_class) =
        normalize_optional_text(thread_read.estimated_cost_class.clone())
    {
        lines.push(format!("预估成本等级：{estimated_cost_class}"));
    }
    if let Some(limit_state) = thread_read.limit_state.as_ref() {
        lines.push(format!("额度状态：{}", limit_state.status));
        if !limit_state.notes.is_empty() {
            lines.push(format!("额度备注：{}", limit_state.notes.join("；")));
        }
    }
    if let Some(cost_state) = thread_read.cost_state.as_ref() {
        lines.push(format!("成本状态：{}", cost_state.status));
        if let Some(value) = normalize_optional_text(cost_state.estimated_cost_class.clone()) {
            lines.push(format!("成本等级：{value}"));
        }
    }
    if let Some(limit_event) = thread_read.limit_event.as_ref() {
        lines.push(format!("最近额度事件：{}", limit_event.event_kind));
        if let Some(message) = normalize_optional_text(Some(limit_event.message.clone())) {
            lines.push(format!("额度事件说明：{message}"));
        }
    }
    if let Some(runtime_summary) = thread_read.runtime_summary.as_ref() {
        if let Some(value) = runtime_summary
            .get("decisionReason")
            .and_then(|value| value.as_str())
        {
            lines.push(format!("运行时摘要 / 决策解释：{value}"));
        }
        if let Some(value) = runtime_summary
            .get("capabilityGap")
            .and_then(|value| value.as_str())
        {
            lines.push(format!("运行时摘要 / 能力缺口：{value}"));
        }
        if let Some(value) = runtime_summary
            .get("limitStatus")
            .and_then(|value| value.as_str())
        {
            lines.push(format!("运行时摘要 / 额度：{value}"));
        }
        if let Some(value) = runtime_summary
            .get("estimatedCostClass")
            .and_then(|value| value.as_str())
        {
            lines.push(format!("运行时摘要 / 成本：{value}"));
        }
    }
    if let Some(permission_state) = thread_read.permission_state.as_ref() {
        lines.push(format!(
            "权限状态：{}（required {} / ask {} / blocking {}）",
            permission_state.status,
            permission_state.required_profile_keys.len(),
            permission_state.ask_profile_keys.len(),
            permission_state.blocking_profile_keys.len()
        ));
        if let Some(line) = format_permission_confirmation_line(permission_state) {
            lines.push(line);
        }
    }
    if let Some(oem_policy) = thread_read.oem_policy.as_ref() {
        if let Some(value) = oem_policy
            .get("quotaStatus")
            .and_then(|value| value.as_str())
        {
            lines.push(format!("OEM 额度状态：{value}"));
        }
        if let Some(value) = oem_policy
            .get("defaultModel")
            .and_then(|value| value.as_str())
        {
            lines.push(format!("OEM 模型：{value}"));
        }
        if let Some(value) = oem_policy
            .get("offerState")
            .and_then(|value| value.as_str())
        {
            lines.push(format!("OEM 策略状态：{value}"));
        }
    }
    if let Some(auxiliary_runtime) = thread_read
        .auxiliary_task_runtime
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        lines.push(format!(
            "辅助任务运行时快照：{} 条",
            auxiliary_runtime.len()
        ));
    }

    lines
}

fn build_runtime_facts_json(thread_read: &AgentRuntimeThreadReadModel) -> serde_json::Value {
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
        "auxiliaryTaskRuntime": thread_read.auxiliary_task_runtime
    })
}

fn build_resume_order() -> Vec<&'static str> {
    vec![
        "先读 `handoff.md`，确认当前目标、最近摘要和建议接手顺序。",
        "再读 `progress.json`，获取结构化状态、排队 turn、审批与子任务信息。",
        "需要继续编码时再读 `plan.md` 与 `review-summary.md`，确认 Todo、阻塞和验证动作。",
    ]
}

fn build_review_actions(thread_read: &AgentRuntimeThreadReadModel) -> Vec<String> {
    let mut actions = Vec::new();

    if let Some(permission_state) = thread_read.permission_state.as_ref() {
        if permission_state.confirmation_status.as_deref() == Some("denied") {
            actions.push(format!(
                "权限确认已被拒绝，不能把当前交接作为成功交付证据：request_id={}，source={}。",
                permission_confirmation_request_id(permission_state),
                permission_confirmation_source(permission_state)
            ));
        }
    }

    if !thread_read.pending_requests.is_empty() {
        actions.push(format!(
            "优先处理 {} 个待确认 / 待输入请求，避免线程继续阻塞。",
            thread_read.pending_requests.len()
        ));
    }

    if !thread_read.queued_turns.is_empty() {
        actions.push(format!(
            "当前还有 {} 个排队 turn，恢复线程前先确认是否需要立即执行。",
            thread_read.queued_turns.len()
        ));
    }

    if let Some(diagnostics) = thread_read.diagnostics.as_ref() {
        if let Some(failed_tool) = diagnostics.latest_failed_tool.as_ref() {
            actions.push(format!(
                "检查失败工具 `{}`，必要时先修复工具链或输入参数。",
                failed_tool.tool_name
            ));
        }
        if let Some(failed_command) = diagnostics.latest_failed_command.as_ref() {
            actions.push(format!(
                "复盘失败命令 `{}` 的环境 / 依赖问题，再继续后续执行。",
                failed_command.command
            ));
        }
        if let Some(blocking_summary) = diagnostics.primary_blocking_summary.as_ref() {
            actions.push(format!("优先消除当前主要阻塞：{blocking_summary}"));
        }
    }

    actions
}

fn build_blocking_lines(thread_read: &AgentRuntimeThreadReadModel) -> Vec<String> {
    let mut lines = Vec::new();

    if let Some(permission_state) = thread_read.permission_state.as_ref() {
        if permission_state.confirmation_status.as_deref() == Some("denied") {
            lines.push(format!(
                "权限确认已被拒绝：request_id={}，source={}。",
                permission_confirmation_request_id(permission_state),
                permission_confirmation_source(permission_state)
            ));
        }
    }

    if let Some(diagnostics) = thread_read.diagnostics.as_ref() {
        if let Some(summary) = diagnostics.primary_blocking_summary.as_ref() {
            lines.push(summary.clone());
        }
        if let Some(request) = diagnostics.latest_pending_request.as_ref() {
            let title = request
                .title
                .clone()
                .unwrap_or_else(|| request.request_type.clone());
            lines.push(format!("待处理请求：{title}"));
        }
    }

    if !thread_read.queued_turns.is_empty() {
        lines.push(format!(
            "存在 {} 个排队 turn。",
            thread_read.queued_turns.len()
        ));
    }

    lines
}

fn format_permission_confirmation_line(
    permission_state: &lime_agent::SessionExecutionRuntimePermissionState,
) -> Option<String> {
    let confirmation_status = permission_state.confirmation_status.as_deref()?;
    let request_id = permission_confirmation_request_id(permission_state);
    let source = permission_confirmation_source(permission_state);

    match confirmation_status {
        "denied" => Some(format!(
            "权限确认：已拒绝（request_id={request_id}, source={source}），当前交接不能作为成功交付证据。"
        )),
        "resolved" => Some(format!(
            "权限确认：已通过（request_id={request_id}, source={source}）。"
        )),
        "requested" => Some(format!(
            "权限确认：等待处理（request_id={request_id}, source={source}）。"
        )),
        "not_requested" => Some("权限确认：声明态权限尚未发起真实审批请求。".to_string()),
        other => Some(format!("权限确认：{other}（source={source}）。")),
    }
}

fn permission_confirmation_request_id(
    permission_state: &lime_agent::SessionExecutionRuntimePermissionState,
) -> &str {
    permission_state
        .confirmation_request_id
        .as_deref()
        .unwrap_or("未记录 confirmationRequestId")
}

fn permission_confirmation_source(
    permission_state: &lime_agent::SessionExecutionRuntimePermissionState,
) -> &str {
    permission_state
        .confirmation_source
        .as_deref()
        .unwrap_or("未记录 confirmationSource")
}

fn collect_plan_lines(detail: &SessionDetail) -> Vec<String> {
    detail
        .items
        .iter()
        .filter_map(|item| match &item.payload {
            AgentThreadItemPayload::Plan { text } => normalize_optional_text(Some(text.clone())),
            _ => None,
        })
        .collect()
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

fn summarize_todos(detail: &SessionDetail) -> TodoSummary {
    let mut summary = TodoSummary::default();
    for item in &detail.todo_items {
        summary.total += 1;
        match todo_status_value(item).as_str() {
            "completed" => summary.completed += 1,
            "in_progress" => summary.in_progress += 1,
            _ => summary.pending += 1,
        }
    }
    summary
}

fn count_active_subagents(detail: &SessionDetail) -> usize {
    detail
        .child_subagent_sessions
        .iter()
        .filter(|session| {
            matches!(
                session.runtime_status,
                Some(crate::agent::ChildSubagentRuntimeStatus::Queued)
                    | Some(crate::agent::ChildSubagentRuntimeStatus::Running)
            )
        })
        .count()
}

fn todo_status_value(item: &lime_agent::SessionTodoItem) -> String {
    serde_json::to_value(&item.status)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "pending".to_string())
}

fn todo_status_label(status: &str) -> &'static str {
    match status {
        "completed" => "已完成",
        "in_progress" => "进行中",
        _ => "待开始",
    }
}

fn subagent_status_label(status: crate::agent::ChildSubagentRuntimeStatus) -> &'static str {
    match status {
        crate::agent::ChildSubagentRuntimeStatus::Idle => "空闲",
        crate::agent::ChildSubagentRuntimeStatus::Queued => "排队中",
        crate::agent::ChildSubagentRuntimeStatus::Running => "处理中",
        crate::agent::ChildSubagentRuntimeStatus::Completed => "已完成",
        crate::agent::ChildSubagentRuntimeStatus::Failed => "失败",
        crate::agent::ChildSubagentRuntimeStatus::Aborted => "已中止",
        crate::agent::ChildSubagentRuntimeStatus::Closed => "已关闭",
    }
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
            name: "P2 handoff".to_string(),
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
                prompt_text: "继续推进".to_string(),
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
                        text: "先导出交接制品，再补 UI 入口".to_string(),
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
                        text: "已完成后端导出链路，下一步补前端入口。".to_string(),
                    },
                },
            ],
            todo_items: vec![
                lime_agent::SessionTodoItem {
                    content: "补前端入口".to_string(),
                    status: serde_json::from_value(json!("in_progress")).expect("status"),
                    active_form: None,
                },
                lime_agent::SessionTodoItem {
                    content: "跑契约测试".to_string(),
                    status: serde_json::from_value(json!("pending")).expect("status"),
                    active_form: None,
                },
            ],
            child_subagent_sessions: vec![crate::agent::ChildSubagentSession {
                id: "sub-1".to_string(),
                name: "Review".to_string(),
                created_at: 1,
                updated_at: 2,
                session_type: "subagent".to_string(),
                model: None,
                provider_name: None,
                working_dir: None,
                workspace_id: None,
                task_summary: Some("复查交接制品是否完整".to_string()),
                role_hint: Some("审查".to_string()),
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
            status: "running".to_string(),
            active_turn_id: Some("turn-1".to_string()),
            pending_requests: vec![crate::commands::aster_agent_cmd::AgentRuntimeRequestView {
                id: "req-1".to_string(),
                thread_id: "thread-1".to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: None,
                request_type: "tool_confirmation".to_string(),
                status: "pending".to_string(),
                title: Some("确认写入交接文件".to_string()),
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
                message_preview: "继续补交接 UI".to_string(),
                message_text: "继续补交接 UI".to_string(),
                created_at: 3,
                image_count: 0,
                position: 1,
            }],
            interrupt_state: None,
            updated_at: Some("2026-03-27T10:01:00Z".to_string()),
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
                primary_blocking_summary: Some("等待用户确认写入交接文件".to_string()),
                latest_warning: None,
                latest_context_compaction: None,
                latest_failed_tool: None,
                latest_failed_command: None,
                latest_pending_request: Some(
                    crate::commands::aster_agent_cmd::AgentRuntimeDiagnosticPendingRequestSample {
                        request_id: "req-1".to_string(),
                        turn_id: Some("turn-1".to_string()),
                        request_type: "tool_confirmation".to_string(),
                        title: Some("确认写入交接文件".to_string()),
                        waited_seconds: Some(12),
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
            permission_state: None,
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

    fn set_permission_confirmation(
        thread_read: &mut AgentRuntimeThreadReadModel,
        confirmation_status: &str,
        request_id: &str,
    ) {
        thread_read.permission_state = Some(lime_agent::SessionExecutionRuntimePermissionState {
            status: "requires_confirmation".to_string(),
            required_profile_keys: vec!["browser_control".to_string()],
            ask_profile_keys: vec!["browser_control".to_string()],
            blocking_profile_keys: Vec::new(),
            decision_source: "runtime_task_profile".to_string(),
            decision_scope: "declared_profile_only".to_string(),
            confirmation_status: Some(confirmation_status.to_string()),
            confirmation_request_id: Some(request_id.to_string()),
            confirmation_source: Some("runtime_action_required".to_string()),
            notes: Vec::new(),
        });
    }

    #[test]
    fn should_export_runtime_handoff_bundle_to_workspace() {
        let temp_dir = TempDir::new().expect("temp dir");
        let detail = build_detail();
        let thread_read = build_thread_read();

        let result =
            export_runtime_handoff_bundle(&detail, &thread_read, temp_dir.path()).expect("export");

        assert_eq!(
            result.bundle_relative_root,
            ".lime/harness/sessions/session-1"
        );
        assert_eq!(result.artifacts.len(), 4);
        assert_eq!(result.pending_request_count, 1);
        assert_eq!(result.queued_turn_count, 1);
        assert_eq!(result.active_subagent_count, 1);
        assert_eq!(result.todo_total, 2);

        let plan_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/plan.md");
        let handoff_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/handoff.md");
        let progress_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/progress.json");

        assert!(plan_path.exists());
        assert!(handoff_path.exists());
        assert!(progress_path.exists());

        let plan = fs::read_to_string(plan_path).expect("plan");
        assert!(plan.contains("会话计划"));
        assert!(plan.contains("补前端入口"));
        assert!(plan.contains("运行时事实"));
        assert!(plan.contains("决策解释：主路由能力不足，切到回退模型"));

        let handoff = fs::read_to_string(handoff_path).expect("handoff");
        assert!(handoff.contains("已完成后端导出链路"));
        assert!(handoff.contains("推荐接手顺序"));

        let progress = fs::read_to_string(progress_path).expect("progress");
        assert!(progress.contains("\"sessionId\": \"session-1\""));
        assert!(progress.contains("\"pendingRequestCount\": 1"));
    }

    #[test]
    fn should_surface_denied_permission_confirmation_in_handoff_bundle() {
        let temp_dir = TempDir::new().expect("temp dir");
        let detail = build_detail();
        let mut thread_read = build_thread_read();
        set_permission_confirmation(&mut thread_read, "denied", "approval-denied");

        export_runtime_handoff_bundle(&detail, &thread_read, temp_dir.path()).expect("export");

        let plan = fs::read_to_string(
            temp_dir
                .path()
                .join(".lime/harness/sessions/session-1/plan.md"),
        )
        .expect("plan");
        let handoff = fs::read_to_string(
            temp_dir
                .path()
                .join(".lime/harness/sessions/session-1/handoff.md"),
        )
        .expect("handoff");
        let review = fs::read_to_string(
            temp_dir
                .path()
                .join(".lime/harness/sessions/session-1/review-summary.md"),
        )
        .expect("review");
        let progress = fs::read_to_string(
            temp_dir
                .path()
                .join(".lime/harness/sessions/session-1/progress.json"),
        )
        .expect("progress");

        assert!(plan.contains("权限确认已被拒绝"));
        assert!(handoff.contains("权限确认：已拒绝"));
        assert!(review.contains("权限确认已被拒绝"));
        assert!(review.contains("approval-denied"));
        assert!(progress.contains("\"permissionState\""));
        assert!(progress.contains("\"confirmationStatus\": \"denied\""));
    }

    #[test]
    fn runtime_fact_lines_should_surface_resolved_permission_confirmation() {
        let mut thread_read = build_thread_read();
        set_permission_confirmation(&mut thread_read, "resolved", "approval-resolved");

        let lines = build_runtime_fact_lines(&thread_read);

        assert!(lines.iter().any(|line| line.contains("权限确认：已通过")));
        assert!(lines.iter().any(|line| line.contains("approval-resolved")));
    }
}
