//! Runtime review decision 模板导出服务
//!
//! 将外部 Claude Code / Codex 的分析结论回挂为
//! Lime 工作区内可版本化的人工审核与决策记录模板。
//! 这条链只导出 review-decision 模板，不在 Lime 内自动批准或自动应用修复。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use crate::services::runtime_analysis_handoff_service::{
    export_runtime_analysis_handoff, RuntimeAnalysisArtifact, RuntimeAnalysisHandoffExportResult,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const SESSION_RELATIVE_ROOT: &str = ".lime/harness/sessions";
const REVIEW_DIR_NAME: &str = "review";
const REVIEW_DECISION_MARKDOWN_FILE_NAME: &str = "review-decision.md";
const REVIEW_DECISION_JSON_FILE_NAME: &str = "review-decision.json";
const DEFAULT_DECISION_STATUS: &str = "pending_review";
const DEFAULT_RISK_LEVEL: &str = "unknown";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeReviewDecisionArtifactKind {
    ReviewDecisionMarkdown,
    ReviewDecisionJson,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReviewDecisionArtifact {
    pub kind: RuntimeReviewDecisionArtifactKind,
    pub title: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReviewDecisionTemplateExportResult {
    pub session_id: String,
    pub thread_id: String,
    pub workspace_id: Option<String>,
    pub workspace_root: String,
    pub review_relative_root: String,
    pub review_absolute_root: String,
    pub analysis_relative_root: String,
    pub analysis_absolute_root: String,
    pub handoff_bundle_relative_root: String,
    pub evidence_pack_relative_root: String,
    pub replay_case_relative_root: String,
    pub exported_at: String,
    pub title: String,
    pub thread_status: String,
    pub latest_turn_status: Option<String>,
    pub pending_request_count: usize,
    pub queued_turn_count: usize,
    pub default_decision_status: String,
    pub review_checklist: Vec<String>,
    pub analysis_artifacts: Vec<RuntimeAnalysisArtifact>,
    pub artifacts: Vec<RuntimeReviewDecisionArtifact>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDecisionDocument {
    schema_version: String,
    contract_shape: String,
    exported_at: String,
    source: ReviewDecisionSource,
    review_context: ReviewDecisionContext,
    decision: ReviewDecisionContent,
    decision_status_options: Vec<String>,
    risk_level_options: Vec<String>,
    review_checklist: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDecisionSource {
    derived_from: Vec<String>,
    upstream_alignment: ReviewDecisionUpstreamAlignment,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDecisionUpstreamAlignment {
    execution_environment_reference: String,
    runtime_fact_source: String,
    product_surface: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDecisionContext {
    session_id: String,
    thread_id: String,
    workspace_id: Option<String>,
    title: String,
    thread_status: String,
    latest_turn_status: Option<String>,
    pending_request_count: usize,
    queued_turn_count: usize,
    analysis_relative_root: String,
    handoff_bundle_relative_root: String,
    evidence_pack_relative_root: String,
    replay_case_relative_root: String,
    analysis_artifacts: Vec<ReviewDecisionArtifactReference>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDecisionArtifactReference {
    kind: String,
    title: String,
    relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDecisionContent {
    decision_status: String,
    decision_summary: String,
    chosen_fix_strategy: String,
    risk_level: String,
    risk_tags: Vec<String>,
    human_reviewer: String,
    reviewed_at: Option<String>,
    followup_actions: Vec<String>,
    regression_requirements: Vec<String>,
    notes: String,
}

pub fn export_runtime_review_decision_template(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: &Path,
) -> Result<RuntimeReviewDecisionTemplateExportResult, String> {
    let session_id = detail.id.trim();
    if session_id.is_empty() {
        return Err("session_id 不能为空，无法导出 review decision 模板".to_string());
    }

    let thread_id = detail.thread_id.trim();
    if thread_id.is_empty() {
        return Err("thread_id 不能为空，无法导出 review decision 模板".to_string());
    }

    let workspace_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let exported_at = Utc::now().to_rfc3339();
    let review_relative_root = format!("{SESSION_RELATIVE_ROOT}/{session_id}/{REVIEW_DIR_NAME}");
    let review_absolute_root =
        workspace_root.join(review_relative_root.replace('/', std::path::MAIN_SEPARATOR_STR));

    let analysis = export_runtime_analysis_handoff(detail, thread_read, workspace_root.as_path())?;

    fs::create_dir_all(&review_absolute_root).map_err(|error| {
        format!(
            "创建 review decision 目录失败 {}: {error}",
            review_absolute_root.display()
        )
    })?;

    let review_checklist = build_review_checklist();
    let document = build_review_decision_document(&analysis, &exported_at, &review_checklist);
    let markdown = build_review_decision_markdown(&document);
    let json = serde_json::to_string_pretty(&document)
        .map_err(|error| format!("序列化 review decision json 失败: {error}"))?;

    let artifacts = vec![
        write_review_decision_artifact(
            RuntimeReviewDecisionArtifactKind::ReviewDecisionMarkdown,
            "人工审核记录",
            &review_absolute_root.join(REVIEW_DECISION_MARKDOWN_FILE_NAME),
            &format!("{review_relative_root}/{REVIEW_DECISION_MARKDOWN_FILE_NAME}"),
            markdown.as_bytes(),
        )?,
        write_review_decision_artifact(
            RuntimeReviewDecisionArtifactKind::ReviewDecisionJson,
            "人工审核记录 JSON",
            &review_absolute_root.join(REVIEW_DECISION_JSON_FILE_NAME),
            &format!("{review_relative_root}/{REVIEW_DECISION_JSON_FILE_NAME}"),
            json.as_bytes(),
        )?,
    ];

    Ok(RuntimeReviewDecisionTemplateExportResult {
        session_id: analysis.session_id.clone(),
        thread_id: analysis.thread_id.clone(),
        workspace_id: analysis.workspace_id.clone(),
        workspace_root: analysis.workspace_root.clone(),
        review_relative_root,
        review_absolute_root: to_portable_path(&review_absolute_root.to_string_lossy()),
        analysis_relative_root: analysis.analysis_relative_root.clone(),
        analysis_absolute_root: analysis.analysis_absolute_root.clone(),
        handoff_bundle_relative_root: analysis.handoff_bundle_relative_root.clone(),
        evidence_pack_relative_root: analysis.evidence_pack_relative_root.clone(),
        replay_case_relative_root: analysis.replay_case_relative_root.clone(),
        exported_at,
        title: analysis.title.clone(),
        thread_status: analysis.thread_status.clone(),
        latest_turn_status: analysis.latest_turn_status.clone(),
        pending_request_count: analysis.pending_request_count,
        queued_turn_count: analysis.queued_turn_count,
        default_decision_status: DEFAULT_DECISION_STATUS.to_string(),
        review_checklist,
        analysis_artifacts: analysis.artifacts.clone(),
        artifacts,
    })
}

fn build_review_decision_document(
    analysis: &RuntimeAnalysisHandoffExportResult,
    exported_at: &str,
    review_checklist: &[String],
) -> ReviewDecisionDocument {
    ReviewDecisionDocument {
        schema_version: "v1".to_string(),
        contract_shape: "lime_review_decision_template".to_string(),
        exported_at: exported_at.to_string(),
        source: ReviewDecisionSource {
            derived_from: vec![
                "lime_external_analysis_handoff".to_string(),
                "runtime_handoff_bundle".to_string(),
                "runtime_evidence_pack".to_string(),
                "runtime_replay_case".to_string(),
            ],
            upstream_alignment: ReviewDecisionUpstreamAlignment {
                execution_environment_reference: "codex".to_string(),
                runtime_fact_source: "aster-rust".to_string(),
                product_surface: "lime".to_string(),
            },
        },
        review_context: ReviewDecisionContext {
            session_id: analysis.session_id.clone(),
            thread_id: analysis.thread_id.clone(),
            workspace_id: analysis.workspace_id.clone(),
            title: analysis.title.clone(),
            thread_status: analysis.thread_status.clone(),
            latest_turn_status: analysis.latest_turn_status.clone(),
            pending_request_count: analysis.pending_request_count,
            queued_turn_count: analysis.queued_turn_count,
            analysis_relative_root: analysis.analysis_relative_root.clone(),
            handoff_bundle_relative_root: analysis.handoff_bundle_relative_root.clone(),
            evidence_pack_relative_root: analysis.evidence_pack_relative_root.clone(),
            replay_case_relative_root: analysis.replay_case_relative_root.clone(),
            analysis_artifacts: analysis
                .artifacts
                .iter()
                .map(|artifact| ReviewDecisionArtifactReference {
                    kind: review_analysis_artifact_kind_key(&artifact.kind).to_string(),
                    title: artifact.title.clone(),
                    relative_path: artifact.relative_path.clone(),
                })
                .collect(),
        },
        decision: ReviewDecisionContent {
            decision_status: DEFAULT_DECISION_STATUS.to_string(),
            decision_summary: String::new(),
            chosen_fix_strategy: String::new(),
            risk_level: DEFAULT_RISK_LEVEL.to_string(),
            risk_tags: Vec::new(),
            human_reviewer: String::new(),
            reviewed_at: None,
            followup_actions: Vec::new(),
            regression_requirements: Vec::new(),
            notes: String::new(),
        },
        decision_status_options: vec![
            "accepted".to_string(),
            "deferred".to_string(),
            "rejected".to_string(),
            "needs_more_evidence".to_string(),
            DEFAULT_DECISION_STATUS.to_string(),
        ],
        risk_level_options: vec![
            "low".to_string(),
            "medium".to_string(),
            "high".to_string(),
            DEFAULT_RISK_LEVEL.to_string(),
        ],
        review_checklist: review_checklist.to_vec(),
    }
}

fn build_review_decision_markdown(document: &ReviewDecisionDocument) -> String {
    let checklist = document
        .review_checklist
        .iter()
        .map(|item| format!("- [ ] {item}"))
        .collect::<Vec<_>>()
        .join("\n");
    let analysis_files = document
        .review_context
        .analysis_artifacts
        .iter()
        .map(|artifact| format!("- `{}`：`{}`", artifact.title, artifact.relative_path))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "# Lime 人工审核与决策记录\n\n\
> 状态：`{decision_status}`\n\
> 导出时间：`{exported_at}`\n\
> 说明：这份模板用于把外部 Claude Code / Codex 的分析结论，回挂为 Lime 工作区内可版本化的人工审核记录；最终是否接受修复仍由开发者决定。\n\n\
## 1. 审核上下文\n\
- 标题：{title}\n\
- session_id：`{session_id}`\n\
- thread_id：`{thread_id}`\n\
- 线程状态：`{thread_status}`\n\
- 最新 Turn：`{latest_turn_status}`\n\
- 待处理请求：`{pending_request_count}`\n\
- 排队任务：`{queued_turn_count}`\n\
- analysis 目录：`{analysis_relative_root}`\n\
- handoff 目录：`{handoff_bundle_relative_root}`\n\
- evidence 目录：`{evidence_pack_relative_root}`\n\
- replay 目录：`{replay_case_relative_root}`\n\n\
### 关联分析文件\n\
{analysis_files}\n\n\
## 2. 上游对齐\n\
- 执行环境参照：`codex`\n\
- 运行时事实源：`aster-rust`\n\
- 产品承接面：`lime`\n\n\
## 3. 审核清单\n\
{checklist}\n\n\
## 4. 决策状态\n\
- 当前值：`{decision_status}`\n\
- 可选值：`accepted` / `deferred` / `rejected` / `needs_more_evidence`\n\n\
## 5. 决策摘要\n\
待填写。\n\n\
## 6. 采用的修复策略\n\
待填写。\n\n\
## 7. 风险等级与标签\n\
- 风险等级：`{risk_level}`\n\
- 风险标签：待填写\n\n\
## 8. 回归要求\n\
- 待填写\n\n\
## 9. 后续动作\n\
- 待填写\n\n\
## 10. 审核备注\n\
- 审核人：待填写\n\
- 审核时间：待填写\n\
- 备注：待填写\n",
        decision_status = document.decision.decision_status,
        exported_at = document.exported_at,
        title = empty_fallback(&document.review_context.title, "未命名"),
        session_id = document.review_context.session_id,
        thread_id = document.review_context.thread_id,
        thread_status = empty_fallback(&document.review_context.thread_status, "unknown"),
        latest_turn_status = document
            .review_context
            .latest_turn_status
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("unknown"),
        pending_request_count = document.review_context.pending_request_count,
        queued_turn_count = document.review_context.queued_turn_count,
        analysis_relative_root = document.review_context.analysis_relative_root,
        handoff_bundle_relative_root = document.review_context.handoff_bundle_relative_root,
        evidence_pack_relative_root = document.review_context.evidence_pack_relative_root,
        replay_case_relative_root = document.review_context.replay_case_relative_root,
        analysis_files = if analysis_files.is_empty() {
            "- 待补充".to_string()
        } else {
            analysis_files
        },
        checklist = if checklist.is_empty() {
            "- [ ] 待补充审核清单".to_string()
        } else {
            checklist
        },
        risk_level = document.decision.risk_level,
    )
}

fn build_review_checklist() -> Vec<String> {
    vec![
        "先阅读 analysis-brief.md 与 analysis-context.json，再决定是否进入修复。".to_string(),
        "确认根因判断引用的是现有证据，而不是外部 AI 的猜测扩写。".to_string(),
        "确认修复范围仍落在 current 主链，没有把 compat / deprecated 路径重新接回主线。"
            .to_string(),
        "明确最小回归集合，包括 contract、GUI smoke、Replay 或其它定向验证。".to_string(),
        "把最终决定记录为 accepted / deferred / rejected / needs_more_evidence 之一。".to_string(),
    ]
}

fn review_analysis_artifact_kind_key(
    kind: &crate::services::runtime_analysis_handoff_service::RuntimeAnalysisArtifactKind,
) -> &'static str {
    match kind {
        crate::services::runtime_analysis_handoff_service::RuntimeAnalysisArtifactKind::AnalysisBrief => {
            "analysis_brief"
        }
        crate::services::runtime_analysis_handoff_service::RuntimeAnalysisArtifactKind::AnalysisContext => {
            "analysis_context"
        }
    }
}

fn write_review_decision_artifact(
    kind: RuntimeReviewDecisionArtifactKind,
    title: &str,
    absolute_path: &Path,
    relative_path: &str,
    contents: &[u8],
) -> Result<RuntimeReviewDecisionArtifact, String> {
    fs::write(absolute_path, contents).map_err(|error| {
        format!(
            "写入 review decision 文件失败 {}: {error}",
            absolute_path.display()
        )
    })?;

    Ok(RuntimeReviewDecisionArtifact {
        kind,
        title: title.to_string(),
        relative_path: relative_path.to_string(),
        absolute_path: to_portable_path(&absolute_path.to_string_lossy()),
        bytes: contents.len(),
    })
}

fn empty_fallback<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

fn to_portable_path(value: &str) -> String {
    value.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::QueuedTurnSnapshot;
    use crate::commands::aster_agent_cmd::{
        AgentRuntimeDiagnosticPendingRequestSample, AgentRuntimeRequestView,
        AgentRuntimeThreadDiagnostics,
    };
    use lime_core::database::dao::agent_timeline::{
        AgentThreadItem, AgentThreadItemPayload, AgentThreadItemStatus, AgentThreadTurn,
        AgentThreadTurnStatus,
    };
    use serde_json::json;
    use tempfile::TempDir;

    fn build_detail() -> SessionDetail {
        SessionDetail {
            id: "session-1".to_string(),
            thread_id: "thread-1".to_string(),
            workspace_id: Some("workspace-1".to_string()),
            name: "Harness Review Demo".to_string(),
            model: Some("gpt-5.4".to_string()),
            working_dir: Some("/tmp/workspace".to_string()),
            created_at: 1,
            updated_at: 2,
            execution_strategy: Some("react".to_string()),
            messages: Vec::new(),
            execution_runtime: None,
            turns: vec![AgentThreadTurn {
                id: "turn-1".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "请导出 review decision 模板。".to_string(),
                status: AgentThreadTurnStatus::Completed,
                started_at: "2026-03-27T10:00:00Z".to_string(),
                completed_at: Some("2026-03-27T10:01:00Z".to_string()),
                error_message: None,
                created_at: "2026-03-27T10:00:00Z".to_string(),
                updated_at: "2026-03-27T10:01:00Z".to_string(),
            }],
            items: vec![
                AgentThreadItem {
                    id: "item-plan-1".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    sequence: 1,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-27T10:00:10Z".to_string(),
                    completed_at: Some("2026-03-27T10:00:10Z".to_string()),
                    updated_at: "2026-03-27T10:00:10Z".to_string(),
                    payload: AgentThreadItemPayload::Plan {
                        text: "补 review decision 模板导出".to_string(),
                    },
                },
                AgentThreadItem {
                    id: "item-summary-1".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    sequence: 2,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-27T10:01:00Z".to_string(),
                    completed_at: Some("2026-03-27T10:01:00Z".to_string()),
                    updated_at: "2026-03-27T10:01:00Z".to_string(),
                    payload: AgentThreadItemPayload::TurnSummary {
                        text: "外部分析已可导出，下一步需要固定人工审核记录。".to_string(),
                    },
                },
            ],
            todo_items: vec![lime_agent::SessionTodoItem {
                content: "导出人工审核记录".to_string(),
                status: serde_json::from_value(json!("in_progress")).expect("status"),
                active_form: None,
            }],
            child_subagent_sessions: vec![],
            subagent_parent_context: None,
        }
    }

    fn build_thread_read() -> AgentRuntimeThreadReadModel {
        AgentRuntimeThreadReadModel {
            thread_id: "thread-1".to_string(),
            status: "waiting_request".to_string(),
            active_turn_id: Some("turn-1".to_string()),
            pending_requests: vec![AgentRuntimeRequestView {
                id: "req-1".to_string(),
                thread_id: "thread-1".to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: Some("request-1".to_string()),
                request_type: "approval_request".to_string(),
                status: "pending".to_string(),
                title: Some("是否接受最小修复".to_string()),
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
                message_preview: "继续补 review decision".to_string(),
                message_text: "继续补 review decision".to_string(),
                created_at: 3,
                image_count: 0,
                position: 1,
            }],
            interrupt_state: None,
            updated_at: Some("2026-03-27T10:01:20Z".to_string()),
            diagnostics: Some(AgentRuntimeThreadDiagnostics {
                latest_turn_status: Some("action_required".to_string()),
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
                primary_blocking_summary: Some("等待人工审核修复方案".to_string()),
                latest_warning: None,
                latest_context_compaction: None,
                latest_failed_tool: None,
                latest_failed_command: None,
                latest_pending_request: Some(AgentRuntimeDiagnosticPendingRequestSample {
                    request_id: "req-1".to_string(),
                    turn_id: Some("turn-1".to_string()),
                    request_type: "approval_request".to_string(),
                    title: Some("是否接受最小修复".to_string()),
                    waited_seconds: Some(10),
                    created_at: None,
                }),
            }),
        }
    }

    #[test]
    fn should_export_runtime_review_decision_template_to_workspace() {
        let temp_dir = TempDir::new().expect("temp dir");
        let detail = build_detail();
        let thread_read = build_thread_read();

        let result =
            export_runtime_review_decision_template(&detail, &thread_read, temp_dir.path())
                .expect("export");

        assert_eq!(
            result.review_relative_root,
            ".lime/harness/sessions/session-1/review"
        );
        assert_eq!(result.default_decision_status, "pending_review");
        assert_eq!(result.artifacts.len(), 2);
        assert_eq!(result.analysis_artifacts.len(), 2);
        assert!(!result.review_checklist.is_empty());

        let markdown_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/review/review-decision.md");
        let json_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/review/review-decision.json");

        assert!(markdown_path.exists());
        assert!(json_path.exists());

        let markdown = fs::read_to_string(markdown_path).expect("markdown");
        assert!(markdown.contains("人工审核与决策记录"));
        assert!(markdown.contains("analysis-brief.md"));
        assert!(markdown.contains("aster-rust"));
        assert!(markdown.contains("pending_review"));

        let json = fs::read_to_string(json_path).expect("json");
        assert!(json.contains("\"contractShape\": \"lime_review_decision_template\""));
        assert!(json.contains("\"decisionStatus\": \"pending_review\""));
        assert!(json.contains("\"executionEnvironmentReference\": \"codex\""));
        assert!(json.contains("\"runtimeFactSource\": \"aster-rust\""));
    }
}
