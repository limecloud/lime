//! Runtime review decision 模板导出与保存服务
//!
//! 将外部代码助手 / Codex 的分析结论回挂为
//! Lime 工作区内可版本化的人工审核与决策记录模板。
//! 这条链只导出与保存 review-decision，不在 Lime 内自动批准或自动应用修复。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use crate::services::runtime_analysis_handoff_service::{
    export_runtime_analysis_handoff, RuntimeAnalysisArtifact, RuntimeAnalysisHandoffExportResult,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
    pub verification_summary: Option<Value>,
    pub decision: RuntimeReviewDecisionContent,
    pub decision_status_options: Vec<String>,
    pub risk_level_options: Vec<String>,
    pub review_checklist: Vec<String>,
    pub analysis_artifacts: Vec<RuntimeAnalysisArtifact>,
    pub artifacts: Vec<RuntimeReviewDecisionArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDecisionDocument {
    schema_version: String,
    contract_shape: String,
    exported_at: String,
    source: ReviewDecisionSource,
    review_context: ReviewDecisionContext,
    decision: RuntimeReviewDecisionContent,
    decision_status_options: Vec<String>,
    risk_level_options: Vec<String>,
    review_checklist: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDecisionSource {
    derived_from: Vec<String>,
    upstream_alignment: ReviewDecisionUpstreamAlignment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDecisionUpstreamAlignment {
    execution_environment_reference: String,
    runtime_fact_source: String,
    product_surface: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    verification_summary: Option<Value>,
    verification_failure_outcomes: Vec<String>,
    verification_recovered_outcomes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDecisionArtifactReference {
    kind: String,
    title: String,
    relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReviewDecisionContent {
    pub decision_status: String,
    pub decision_summary: String,
    pub chosen_fix_strategy: String,
    pub risk_level: String,
    pub risk_tags: Vec<String>,
    pub human_reviewer: String,
    pub reviewed_at: Option<String>,
    pub followup_actions: Vec<String>,
    pub regression_requirements: Vec<String>,
    pub notes: String,
}

pub fn export_runtime_review_decision_template(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: &Path,
) -> Result<RuntimeReviewDecisionTemplateExportResult, String> {
    sync_runtime_review_decision(detail, thread_read, workspace_root, None)
}

pub fn save_runtime_review_decision(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: &Path,
    decision: RuntimeReviewDecisionContent,
) -> Result<RuntimeReviewDecisionTemplateExportResult, String> {
    sync_runtime_review_decision(detail, thread_read, workspace_root, Some(decision))
}

fn sync_runtime_review_decision(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: &Path,
    decision_override: Option<RuntimeReviewDecisionContent>,
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
    let verification_context = load_analysis_verification_context(&analysis)?;
    let existing_decision = load_existing_review_decision_document(&review_absolute_root)?
        .map(|document| document.decision);
    let mut document = build_review_decision_document(
        &analysis,
        &exported_at,
        &review_checklist,
        &verification_context,
    );
    let decision = decision_override
        .or(existing_decision)
        .unwrap_or_else(|| document.decision.clone());
    document.decision = normalize_review_decision_content(decision, &exported_at);
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
        verification_summary: document.review_context.verification_summary.clone(),
        decision: document.decision,
        decision_status_options: document.decision_status_options,
        risk_level_options: document.risk_level_options,
        review_checklist,
        analysis_artifacts: analysis.artifacts.clone(),
        artifacts,
    })
}

fn build_review_decision_document(
    analysis: &RuntimeAnalysisHandoffExportResult,
    exported_at: &str,
    review_checklist: &[String],
    verification_context: &ReviewDecisionVerificationContext,
) -> ReviewDecisionDocument {
    let suggested_actions = build_review_decision_suggested_actions(verification_context);

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
            verification_summary: verification_context.summary.clone(),
            verification_failure_outcomes: verification_context.failure_outcomes.clone(),
            verification_recovered_outcomes: verification_context.recovered_outcomes.clone(),
        },
        decision: RuntimeReviewDecisionContent {
            decision_status: DEFAULT_DECISION_STATUS.to_string(),
            decision_summary: String::new(),
            chosen_fix_strategy: String::new(),
            risk_level: DEFAULT_RISK_LEVEL.to_string(),
            risk_tags: Vec::new(),
            human_reviewer: String::new(),
            reviewed_at: None,
            followup_actions: suggested_actions.followup_actions,
            regression_requirements: suggested_actions.regression_requirements,
            notes: String::new(),
        },
        decision_status_options: build_decision_status_options(),
        risk_level_options: build_risk_level_options(),
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
    let verification_summary =
        format_markdown_verification_summary(document.review_context.verification_summary.as_ref());
    let verification_failure_outcomes = format_markdown_list(
        &document.review_context.verification_failure_outcomes,
        "- 无",
    );
    let verification_recovered_outcomes = format_markdown_list(
        &document.review_context.verification_recovered_outcomes,
        "- 无",
    );
    let decision_status_options = document
        .decision_status_options
        .iter()
        .map(|status| format!("`{status}`"))
        .collect::<Vec<_>>()
        .join(" / ");
    let risk_tags = format_markdown_inline_list(&document.decision.risk_tags, "待填写");
    let regression_requirements =
        format_markdown_list(&document.decision.regression_requirements, "- 待填写");
    let followup_actions = format_markdown_list(&document.decision.followup_actions, "- 待填写");
    let decision_summary =
        format_markdown_text_block(&document.decision.decision_summary, "待填写。");
    let chosen_fix_strategy =
        format_markdown_text_block(&document.decision.chosen_fix_strategy, "待填写。");
    let notes = format_markdown_text_block(&document.decision.notes, "待填写。");

    format!(
        "# Lime 人工审核与决策记录\n\n\
> 状态：`{decision_status}`\n\
> 导出时间：`{exported_at}`\n\
> 说明：这份模板用于把外部代码助手 / Codex 的分析结论，回挂为 Lime 工作区内可版本化的人工审核记录；最终是否接受修复仍由开发者决定。\n\n\
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
## 4. 结构化验证摘要\n\
{verification_summary}\n\n\
## 5. 验证焦点\n\
- 阻塞 / 提示失败：\n\
{verification_failure_outcomes}\n\n\
- 已恢复结果：\n\
{verification_recovered_outcomes}\n\n\
## 6. 决策状态\n\
- 当前值：`{decision_status}`\n\
- 可选值：{decision_status_options}\n\n\
## 7. 决策摘要\n\
{decision_summary}\n\n\
## 8. 采用的修复策略\n\
{chosen_fix_strategy}\n\n\
## 9. 风险等级与标签\n\
- 风险等级：`{risk_level}`\n\
- 风险标签：{risk_tags}\n\n\
## 10. 回归要求\n\
{regression_requirements}\n\n\
## 11. 后续动作\n\
{followup_actions}\n\n\
## 12. 审核备注\n\
- 审核人：{human_reviewer}\n\
- 审核时间：{reviewed_at}\n\
- 备注：\n{notes}\n",
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
        verification_summary = verification_summary,
        verification_failure_outcomes = verification_failure_outcomes,
        verification_recovered_outcomes = verification_recovered_outcomes,
        decision_status_options = if decision_status_options.is_empty() {
            format!("`{DEFAULT_DECISION_STATUS}`")
        } else {
            decision_status_options
        },
        decision_summary = decision_summary,
        chosen_fix_strategy = chosen_fix_strategy,
        risk_level = document.decision.risk_level,
        risk_tags = risk_tags,
        regression_requirements = regression_requirements,
        followup_actions = followup_actions,
        human_reviewer = empty_fallback(&document.decision.human_reviewer, "待填写"),
        reviewed_at = document
            .decision
            .reviewed_at
            .as_deref()
            .filter(|value: &&str| !value.trim().is_empty())
            .unwrap_or("待填写"),
        notes = notes,
    )
}

fn build_review_checklist() -> Vec<String> {
    vec![
        "先阅读 analysis-brief.md 与 analysis-context.json，再决定是否进入修复。".to_string(),
        "确认根因判断引用的是现有证据，而不是外部 AI 的猜测扩写。".to_string(),
        "优先核对 verification failure / recovered outcomes，再决定是接受、延后还是补充证据。"
            .to_string(),
        "确认修复范围仍落在 current 主链，没有把 compat / deprecated 路径重新接回主线。"
            .to_string(),
        "明确最小回归集合，包括 contract、GUI smoke、Replay 或其它定向验证。".to_string(),
        "把最终决定记录为 accepted / deferred / rejected / needs_more_evidence 之一。".to_string(),
    ]
}

#[derive(Debug, Clone, Default)]
struct ReviewDecisionVerificationContext {
    summary: Option<Value>,
    failure_outcomes: Vec<String>,
    recovered_outcomes: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct ReviewDecisionSuggestedActions {
    followup_actions: Vec<String>,
    regression_requirements: Vec<String>,
}

const REVIEW_VERIFICATION_COMMAND_EVAL: &str = "npm run harness:eval";
const REVIEW_VERIFICATION_COMMAND_TREND: &str = "npm run harness:eval:trend";
const REVIEW_VERIFICATION_COMMAND_GUI_SMOKE: &str = "npm run verify:gui-smoke";

fn load_analysis_verification_context(
    analysis: &RuntimeAnalysisHandoffExportResult,
) -> Result<ReviewDecisionVerificationContext, String> {
    let analysis_context_relative_path = analysis
        .artifacts
        .iter()
        .find(|artifact| {
            matches!(
                artifact.kind,
                crate::services::runtime_analysis_handoff_service::RuntimeAnalysisArtifactKind::AnalysisContext
            )
        })
        .map(|artifact| artifact.relative_path.clone());
    let Some(relative_path) = analysis_context_relative_path else {
        return Ok(ReviewDecisionVerificationContext::default());
    };

    let absolute_path = Path::new(&analysis.workspace_root)
        .join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !absolute_path.exists() {
        return Ok(ReviewDecisionVerificationContext::default());
    }

    let contents = fs::read_to_string(&absolute_path).map_err(|error| {
        format!(
            "读取 analysis context 失败 {}: {error}",
            absolute_path.display()
        )
    })?;
    let payload = serde_json::from_str::<Value>(&contents).map_err(|error| {
        format!(
            "解析 analysis context 失败 {}: {error}",
            absolute_path.display()
        )
    })?;

    Ok(ReviewDecisionVerificationContext {
        summary: payload
            .pointer("/observability/summary/verificationSummary")
            .cloned()
            .or_else(|| {
                payload
                    .pointer("/observability/summary/verification_summary")
                    .cloned()
            }),
        failure_outcomes: payload
            .pointer("/observability/verificationFailureOutcomes")
            .map(value_string_list)
            .unwrap_or_default(),
        recovered_outcomes: payload
            .pointer("/observability/verificationRecoveredOutcomes")
            .map(value_string_list)
            .unwrap_or_default(),
    })
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

fn load_existing_review_decision_document(
    review_absolute_root: &Path,
) -> Result<Option<ReviewDecisionDocument>, String> {
    let json_path = review_absolute_root.join(REVIEW_DECISION_JSON_FILE_NAME);
    if !json_path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&json_path).map_err(|error| {
        format!(
            "读取已有 review decision json 失败 {}: {error}",
            json_path.display()
        )
    })?;
    let document = serde_json::from_str::<ReviewDecisionDocument>(&contents).map_err(|error| {
        format!(
            "解析已有 review decision json 失败 {}: {error}",
            json_path.display()
        )
    })?;
    Ok(Some(document))
}

fn normalize_review_decision_content(
    decision: RuntimeReviewDecisionContent,
    exported_at: &str,
) -> RuntimeReviewDecisionContent {
    let decision_status = normalize_review_decision_status(&decision.decision_status);
    let decision_summary = normalize_string(&decision.decision_summary);
    let chosen_fix_strategy = normalize_string(&decision.chosen_fix_strategy);
    let risk_level = normalize_review_risk_level(&decision.risk_level);
    let risk_tags = normalize_string_list(&decision.risk_tags);
    let human_reviewer = normalize_string(&decision.human_reviewer);
    let followup_actions = normalize_string_list(&decision.followup_actions);
    let regression_requirements = normalize_string_list(&decision.regression_requirements);
    let notes = normalize_string(&decision.notes);
    let reviewed_at = normalize_optional_string(decision.reviewed_at.as_deref()).or_else(|| {
        let has_review_content = decision_status != DEFAULT_DECISION_STATUS
            || !decision_summary.is_empty()
            || !chosen_fix_strategy.is_empty()
            || risk_level != DEFAULT_RISK_LEVEL
            || !risk_tags.is_empty()
            || !human_reviewer.is_empty()
            || !followup_actions.is_empty()
            || !regression_requirements.is_empty()
            || !notes.is_empty();
        has_review_content.then(|| exported_at.to_string())
    });

    RuntimeReviewDecisionContent {
        decision_status,
        decision_summary,
        chosen_fix_strategy,
        risk_level,
        risk_tags,
        human_reviewer,
        reviewed_at,
        followup_actions,
        regression_requirements,
        notes,
    }
}

fn build_decision_status_options() -> Vec<String> {
    vec![
        "accepted".to_string(),
        "deferred".to_string(),
        "rejected".to_string(),
        "needs_more_evidence".to_string(),
        DEFAULT_DECISION_STATUS.to_string(),
    ]
}

fn build_risk_level_options() -> Vec<String> {
    vec![
        "low".to_string(),
        "medium".to_string(),
        "high".to_string(),
        DEFAULT_RISK_LEVEL.to_string(),
    ]
}

fn normalize_review_decision_status(value: &str) -> String {
    match value.trim() {
        "accepted" => "accepted".to_string(),
        "deferred" => "deferred".to_string(),
        "rejected" => "rejected".to_string(),
        "needs_more_evidence" => "needs_more_evidence".to_string(),
        "pending_review" => "pending_review".to_string(),
        _ => DEFAULT_DECISION_STATUS.to_string(),
    }
}

fn normalize_review_risk_level(value: &str) -> String {
    match value.trim() {
        "low" => "low".to_string(),
        "medium" => "medium".to_string(),
        "high" => "high".to_string(),
        "unknown" => "unknown".to_string(),
        _ => DEFAULT_RISK_LEVEL.to_string(),
    }
}

fn normalize_string(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_string_list(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn build_review_decision_suggested_actions(
    verification_context: &ReviewDecisionVerificationContext,
) -> ReviewDecisionSuggestedActions {
    let mut suggested_actions = ReviewDecisionSuggestedActions::default();

    if let Some(summary) = verification_context.summary.as_ref() {
        if let Some(artifact_validator) =
            summary_object_field(summary, "artifactValidator", "artifact_validator")
        {
            let artifact_outcome = summary_string_field(artifact_validator, "outcome", "outcome");
            let artifact_issue_count =
                summary_u64_field(artifact_validator, "issueCount", "issue_count").unwrap_or(0);
            let artifact_fallback_count = summary_u64_field(
                artifact_validator,
                "fallbackUsedCount",
                "fallback_used_count",
            )
            .unwrap_or(0);

            if matches!(
                artifact_outcome,
                Some("blocking_failure" | "advisory_failure")
            ) {
                if artifact_issue_count > 0 {
                    push_unique_string(
                        &mut suggested_actions.followup_actions,
                        "回看 artifact validator issue 明细，并收敛 evidence pack / artifacts.json / analysis handoff 的 artifact 字段。",
                    );
                }
                if artifact_fallback_count > 0 {
                    push_unique_string(
                        &mut suggested_actions.followup_actions,
                        "补齐 artifact 主路径导出与修复链，减少 fallback_used 持续留在 current 样本。",
                    );
                }
            }

            if matches!(artifact_outcome, Some("recovered")) {
                push_review_verification_eval_commands(
                    &mut suggested_actions.regression_requirements,
                );
                push_unique_string(
                    &mut suggested_actions.followup_actions,
                    "在 evidence pack / analysis handoff 里同时保留 artifact issue 与 repaired outcome，避免只剩修复结论而丢失修复上下文。",
                );
            }
        }

        if let Some(browser_verification) =
            summary_object_field(summary, "browserVerification", "browser_verification")
        {
            let browser_outcome = summary_string_field(browser_verification, "outcome", "outcome");

            if matches!(browser_outcome, Some("blocking_failure")) {
                push_review_verification_eval_commands(
                    &mut suggested_actions.regression_requirements,
                );
                push_unique_string(
                    &mut suggested_actions.followup_actions,
                    "回看 browser replay / browser verification 失败样本，并把失败断言回挂到受影响主路径。",
                );
            }

            if matches!(browser_outcome, Some("advisory_failure")) {
                push_unique_string(
                    &mut suggested_actions.followup_actions,
                    "回看 browser verification 导出链，确保 evidence pack / replay / analysis handoff 写出明确 success 或 failure，而不是 unknown。",
                );
            }

            if matches!(browser_outcome, Some("success" | "recovered")) {
                push_review_verification_eval_commands(
                    &mut suggested_actions.regression_requirements,
                );
                push_unique_string(
                    &mut suggested_actions.followup_actions,
                    "把 browser verification 成功样本固定进 current replay 基线，后续 failure 或 unknown 直接对比这条正向路径。",
                );
            }
        }

        if let Some(gui_smoke) = summary_object_field(summary, "guiSmoke", "gui_smoke") {
            let gui_smoke_outcome = summary_string_field(gui_smoke, "outcome", "outcome");

            if matches!(gui_smoke_outcome, Some("blocking_failure")) {
                push_review_verification_eval_commands(
                    &mut suggested_actions.regression_requirements,
                );
                push_unique_string(
                    &mut suggested_actions.regression_requirements,
                    REVIEW_VERIFICATION_COMMAND_GUI_SMOKE,
                );
                push_unique_string(
                    &mut suggested_actions.followup_actions,
                    "优先收敛 GUI 壳 / DevBridge / Workspace 主路径，再复跑 `npm run verify:gui-smoke`。",
                );
            }

            if matches!(gui_smoke_outcome, Some("success" | "recovered")) {
                push_review_verification_eval_commands(
                    &mut suggested_actions.regression_requirements,
                );
                push_unique_string(
                    &mut suggested_actions.regression_requirements,
                    REVIEW_VERIFICATION_COMMAND_GUI_SMOKE,
                );
                push_unique_string(
                    &mut suggested_actions.followup_actions,
                    "主路径变更时优先复跑 `npm run verify:gui-smoke`，确认 GUI 壳 / DevBridge / Workspace 不从 passed 回退。",
                );
            }
        }
    }

    if suggested_actions.followup_actions.is_empty()
        && !verification_context.failure_outcomes.is_empty()
    {
        push_unique_string(
            &mut suggested_actions.followup_actions,
            "先对照 analysis-context.json / evidence/runtime.json 核对当前验证失败焦点，再决定是继续修复还是补证据。",
        );
        push_unique_string(
            &mut suggested_actions.regression_requirements,
            "按 replay case 复现问题并确认修复后行为与预期一致。",
        );
    }

    if suggested_actions.followup_actions.is_empty()
        && !verification_context.recovered_outcomes.is_empty()
    {
        push_unique_string(
            &mut suggested_actions.followup_actions,
            "把 recovered outcome 回挂到 replay / smoke / evidence 主链，避免后续审核再次把已恢复结果误判成当前阻塞。",
        );
    }

    suggested_actions
}

fn push_review_verification_eval_commands(target: &mut Vec<String>) {
    push_unique_string(target, REVIEW_VERIFICATION_COMMAND_EVAL);
    push_unique_string(target, REVIEW_VERIFICATION_COMMAND_TREND);
}

fn value_string_list(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn push_unique_string(target: &mut Vec<String>, value: &str) {
    let normalized = value.trim();
    if normalized.is_empty() || target.iter().any(|item| item == normalized) {
        return;
    }
    target.push(normalized.to_string());
}

fn format_markdown_verification_summary(summary: Option<&Value>) -> String {
    let Some(summary) = summary else {
        return "- 当前没有结构化验证摘要。".to_string();
    };

    let mut lines = Vec::new();

    if let Some(artifact_validator) =
        summary_object_field(summary, "artifactValidator", "artifact_validator")
    {
        lines.push(format!(
            "- Artifact 校验：`{}`｜{}",
            format_verification_outcome_label(summary_string_field(
                artifact_validator,
                "outcome",
                "outcome",
            )),
            describe_artifact_validator_summary(artifact_validator),
        ));
    }

    if let Some(browser_verification) =
        summary_object_field(summary, "browserVerification", "browser_verification")
    {
        lines.push(format!(
            "- 浏览器验证：`{}`｜{}",
            format_verification_outcome_label(summary_string_field(
                browser_verification,
                "outcome",
                "outcome",
            )),
            describe_browser_verification_summary(browser_verification),
        ));
    }

    if let Some(gui_smoke) = summary_object_field(summary, "guiSmoke", "gui_smoke") {
        lines.push(format!(
            "- GUI Smoke：`{}`｜{}",
            format_verification_outcome_label(summary_string_field(
                gui_smoke, "outcome", "outcome",
            )),
            describe_gui_smoke_summary(gui_smoke),
        ));
    }

    if lines.is_empty() {
        "- 当前没有结构化验证摘要。".to_string()
    } else {
        lines.join("\n")
    }
}

fn summary_object_field<'a>(
    summary: &'a Value,
    camel_case: &str,
    snake_case: &str,
) -> Option<&'a Value> {
    summary
        .get(camel_case)
        .or_else(|| summary.get(snake_case))
        .filter(|value| value.is_object())
}

fn summary_string_field<'a>(
    summary: &'a Value,
    camel_case: &str,
    snake_case: &str,
) -> Option<&'a str> {
    summary
        .get(camel_case)
        .or_else(|| summary.get(snake_case))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn summary_u64_field(summary: &Value, camel_case: &str, snake_case: &str) -> Option<u64> {
    summary
        .get(camel_case)
        .or_else(|| summary.get(snake_case))
        .and_then(Value::as_u64)
}

fn summary_bool_field(summary: &Value, camel_case: &str, snake_case: &str) -> Option<bool> {
    summary
        .get(camel_case)
        .or_else(|| summary.get(snake_case))
        .and_then(Value::as_bool)
}

fn format_verification_outcome_label(value: Option<&str>) -> &'static str {
    match value {
        Some("success") => "通过",
        Some("blocking_failure") => "阻塞失败",
        Some("advisory_failure") => "提示失败",
        Some("recovered") => "已恢复",
        _ => "未定",
    }
}

fn describe_artifact_validator_summary(summary: &Value) -> String {
    if summary_bool_field(summary, "applicable", "applicable") == Some(false) {
        return "当前没有适用的 Artifact 校验。".to_string();
    }

    format!(
        "记录 {} · issues {} · repaired {} · fallback {}",
        summary_u64_field(summary, "recordCount", "record_count").unwrap_or(0),
        summary_u64_field(summary, "issueCount", "issue_count").unwrap_or(0),
        summary_u64_field(summary, "repairedCount", "repaired_count").unwrap_or(0),
        summary_u64_field(summary, "fallbackUsedCount", "fallback_used_count").unwrap_or(0),
    )
}

fn describe_browser_verification_summary(summary: &Value) -> String {
    format!(
        "记录 {} · 成功 {} · 失败 {} · 未判定 {}",
        summary_u64_field(summary, "recordCount", "record_count").unwrap_or(0),
        summary_u64_field(summary, "successCount", "success_count").unwrap_or(0),
        summary_u64_field(summary, "failureCount", "failure_count").unwrap_or(0),
        summary_u64_field(summary, "unknownCount", "unknown_count").unwrap_or(0),
    )
}

fn describe_gui_smoke_summary(summary: &Value) -> String {
    let status = summary_string_field(summary, "status", "status").unwrap_or("未知");
    let exit_code = summary_u64_field(summary, "exitCode", "exit_code")
        .map(|value| value.to_string())
        .unwrap_or_else(|| "未知".to_string());
    let passed = summary_bool_field(summary, "passed", "passed").unwrap_or(false);

    format!(
        "状态 {} · exit {} · {}",
        status,
        exit_code,
        if passed { "已通过" } else { "未通过" }
    )
}

fn format_markdown_text_block(value: &str, placeholder: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        placeholder.to_string()
    } else {
        trimmed.to_string()
    }
}

fn format_markdown_list(values: &[String], placeholder: &str) -> String {
    if values.is_empty() {
        placeholder.to_string()
    } else {
        values
            .iter()
            .map(|value| format!("- {value}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn format_markdown_inline_list(values: &[String], placeholder: &str) -> String {
    if values.is_empty() {
        placeholder.to_string()
    } else {
        values
            .iter()
            .map(|value| format!("`{value}`"))
            .collect::<Vec<_>>()
            .join(" / ")
    }
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
            latest_compaction_boundary: None,
            file_checkpoint_summary: None,
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
            task_kind: None,
            service_model_slot: None,
            routing_mode: None,
            decision_source: None,
            candidate_count: None,
            capability_gap: None,
            single_candidate_only: None,
            oem_policy: None,
            runtime_summary: None,
            decision_reason: None,
            fallback_chain: None,
            auxiliary_task_runtime: None,
            limit_state: None,
            estimated_cost_class: None,
            cost_state: None,
            limit_event: None,
        }
    }

    fn seed_recovered_verification(detail: &mut SessionDetail, root: &std::path::Path) {
        let artifact_relative_path = ".lime/artifacts/thread-1/report.artifact.json";
        let artifact_absolute_path =
            root.join(artifact_relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));

        fs::create_dir_all(
            artifact_absolute_path
                .parent()
                .expect("artifact path should have parent"),
        )
        .expect("create artifact dir");
        fs::write(
            &artifact_absolute_path,
            serde_json::to_string_pretty(&json!({
                "schemaVersion": crate::services::artifact_document_validator::ARTIFACT_DOCUMENT_SCHEMA_VERSION,
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

        detail.items.push(AgentThreadItem {
            id: "artifact-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 3,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:20Z".to_string(),
            completed_at: Some("2026-03-27T10:00:20Z".to_string()),
            updated_at: "2026-03-27T10:00:20Z".to_string(),
            payload: AgentThreadItemPayload::FileArtifact {
                path: artifact_relative_path.to_string(),
                source: "artifact_snapshot".to_string(),
                content: None,
                metadata: None,
            },
        });
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
                cwd: root.to_string_lossy().to_string(),
                aggregated_output: Some("GUI smoke finished successfully".to_string()),
                exit_code: Some(0),
                error: None,
            },
        });
    }

    fn seed_blocking_verification(detail: &mut SessionDetail, root: &std::path::Path) {
        let artifact_relative_path = ".lime/artifacts/thread-1/report-blocking.artifact.json";
        let artifact_absolute_path =
            root.join(artifact_relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));

        fs::create_dir_all(
            artifact_absolute_path
                .parent()
                .expect("artifact path should have parent"),
        )
        .expect("create artifact dir");
        fs::write(
            &artifact_absolute_path,
            serde_json::to_string_pretty(&json!({
                "schemaVersion": crate::services::artifact_document_validator::ARTIFACT_DOCUMENT_SCHEMA_VERSION,
                "title": "Harness Evidence Blocking",
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
                    "artifactValidationIssues": ["title 缺失或为空。"],
                    "artifactValidationRepaired": false,
                    "artifactFallbackUsed": false
                }
            }))
            .expect("serialize artifact document"),
        )
        .expect("write artifact document");

        detail.items.push(AgentThreadItem {
            id: "artifact-blocking-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 3,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:20Z".to_string(),
            completed_at: Some("2026-03-27T10:00:20Z".to_string()),
            updated_at: "2026-03-27T10:00:20Z".to_string(),
            payload: AgentThreadItemPayload::FileArtifact {
                path: artifact_relative_path.to_string(),
                source: "artifact_snapshot".to_string(),
                content: None,
                metadata: None,
            },
        });
        detail.items.push(AgentThreadItem {
            id: "browser-tool-blocking-1".to_string(),
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
                success: Some(false),
                error: Some("browser step failed".to_string()),
                metadata: None,
            },
        });
        detail.items.push(AgentThreadItem {
            id: "gui-smoke-blocking-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 5,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-27T10:00:50Z".to_string(),
            completed_at: Some("2026-03-27T10:00:50Z".to_string()),
            updated_at: "2026-03-27T10:00:50Z".to_string(),
            payload: AgentThreadItemPayload::CommandExecution {
                command: "npm run verify:gui-smoke".to_string(),
                cwd: root.to_string_lossy().to_string(),
                aggregated_output: Some("GUI smoke failed".to_string()),
                exit_code: Some(1),
                error: Some("smoke failed".to_string()),
            },
        });
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
        assert!(result.verification_summary.is_none());

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
        assert!(markdown.contains("结构化验证摘要"));
        assert!(markdown.contains("当前没有结构化验证摘要"));
        assert!(markdown.contains("阻塞 / 提示失败"));
        assert!(markdown.contains("已恢复结果"));
        assert!(markdown.contains("- 无"));
        assert!(result.decision.followup_actions.is_empty());
        assert!(result.decision.regression_requirements.is_empty());

        let json = fs::read_to_string(json_path).expect("json");
        assert!(json.contains("\"contractShape\": \"lime_review_decision_template\""));
        assert!(json.contains("\"decisionStatus\": \"pending_review\""));
        assert!(json.contains("\"executionEnvironmentReference\": \"codex\""));
        assert!(json.contains("\"runtimeFactSource\": \"aster-rust\""));
        assert!(json.contains("\"verificationSummary\": null"));
        assert!(json.contains("\"verificationFailureOutcomes\": []"));
        assert!(json.contains("\"verificationRecoveredOutcomes\": []"));
    }

    #[test]
    fn should_include_verification_outcomes_in_review_decision_when_available() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();
        seed_recovered_verification(&mut detail, temp_dir.path());

        let result =
            export_runtime_review_decision_template(&detail, &thread_read, temp_dir.path())
                .expect("export");

        assert!(result.verification_summary.is_some());

        let markdown_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/review/review-decision.md");
        let json_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/review/review-decision.json");

        let markdown = fs::read_to_string(markdown_path).expect("markdown");
        assert!(markdown.contains("结构化验证摘要"));
        assert!(markdown.contains("Artifact 校验：`已恢复`"));
        assert!(markdown.contains("记录 1 · issues 1 · repaired 1 · fallback 0"));
        assert!(markdown.contains("Artifact 校验已恢复 1 个产物，fallback 0 次。"));
        assert!(markdown.contains("浏览器验证：`通过`"));
        assert!(markdown.contains("GUI Smoke：`通过`"));
        assert!(markdown.contains("- 无"));
        assert_eq!(
            result.decision.followup_actions,
            vec![
                "在 evidence pack / analysis handoff 里同时保留 artifact issue 与 repaired outcome，避免只剩修复结论而丢失修复上下文。"
                    .to_string(),
                "把 browser verification 成功样本固定进 current replay 基线，后续 failure 或 unknown 直接对比这条正向路径。"
                    .to_string(),
                "主路径变更时优先复跑 `npm run verify:gui-smoke`，确认 GUI 壳 / DevBridge / Workspace 不从 passed 回退。"
                    .to_string(),
            ]
        );
        assert_eq!(
            result.decision.regression_requirements,
            vec![
                "npm run harness:eval".to_string(),
                "npm run harness:eval:trend".to_string(),
                "npm run verify:gui-smoke".to_string(),
            ]
        );

        let json = fs::read_to_string(json_path).expect("json");
        assert!(json.contains("\"verificationSummary\": {"));
        assert!(json.contains("\"verificationFailureOutcomes\": []"));
        assert!(json.contains(
            "\"verificationRecoveredOutcomes\": [\n      \"Artifact 校验已恢复 1 个产物，fallback 0 次。\"\n    ]"
        ));
        assert!(json.contains("\"outcome\": \"recovered\""));
    }

    #[test]
    fn should_seed_followup_actions_from_blocking_verification_outcomes() {
        let temp_dir = TempDir::new().expect("temp dir");
        let mut detail = build_detail();
        let thread_read = build_thread_read();
        seed_blocking_verification(&mut detail, temp_dir.path());

        let result =
            export_runtime_review_decision_template(&detail, &thread_read, temp_dir.path())
                .expect("export");

        let markdown_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/review/review-decision.md");
        let markdown = fs::read_to_string(markdown_path).expect("markdown");

        assert_eq!(
            result.decision.followup_actions,
            vec![
                "回看 artifact validator issue 明细，并收敛 evidence pack / artifacts.json / analysis handoff 的 artifact 字段。"
                    .to_string(),
                "回看 browser replay / browser verification 失败样本，并把失败断言回挂到受影响主路径。"
                    .to_string(),
                "优先收敛 GUI 壳 / DevBridge / Workspace 主路径，再复跑 `npm run verify:gui-smoke`。"
                    .to_string(),
            ]
        );
        assert_eq!(
            result.decision.regression_requirements,
            vec![
                "npm run harness:eval".to_string(),
                "npm run harness:eval:trend".to_string(),
                "npm run verify:gui-smoke".to_string(),
            ]
        );
        assert!(markdown.contains(
            "回看 artifact validator issue 明细，并收敛 evidence pack / artifacts.json / analysis handoff 的 artifact 字段。"
        ));
        assert!(markdown.contains("npm run verify:gui-smoke"));
    }

    #[test]
    fn should_save_runtime_review_decision_and_keep_it_on_reexport() {
        let temp_dir = TempDir::new().expect("temp dir");
        let detail = build_detail();
        let thread_read = build_thread_read();

        export_runtime_review_decision_template(&detail, &thread_read, temp_dir.path())
            .expect("export");

        let saved = save_runtime_review_decision(
            &detail,
            &thread_read,
            temp_dir.path(),
            RuntimeReviewDecisionContent {
                decision_status: "accepted".to_string(),
                decision_summary: "确认最小修复落在 current 主链。".to_string(),
                chosen_fix_strategy: "先补 runtime save 命令，再补 Harness UI。".to_string(),
                risk_level: "medium".to_string(),
                risk_tags: vec!["runtime".to_string(), "harness".to_string()],
                human_reviewer: "Lime Maintainer".to_string(),
                reviewed_at: Some("2026-03-27T10:30:00Z".to_string()),
                followup_actions: vec!["补 UI 回归".to_string()],
                regression_requirements: vec![
                    "npm run test:contracts".to_string(),
                    "Rust 定向测试".to_string(),
                ],
                notes: "不要把 compat 命令重新接回主线。".to_string(),
            },
        )
        .expect("save");

        assert_eq!(saved.decision.decision_status, "accepted");
        assert_eq!(saved.decision.risk_level, "medium");
        assert_eq!(saved.decision.risk_tags, vec!["runtime", "harness"]);
        assert_eq!(saved.decision.human_reviewer, "Lime Maintainer");

        let json_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/review/review-decision.json");
        let markdown_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/review/review-decision.md");

        let json = fs::read_to_string(&json_path).expect("json");
        assert!(json.contains("\"decisionStatus\": \"accepted\""));
        assert!(json.contains("\"humanReviewer\": \"Lime Maintainer\""));
        assert!(json.contains("\"regressionRequirements\": ["));

        let markdown = fs::read_to_string(&markdown_path).expect("markdown");
        assert!(markdown.contains("确认最小修复落在 current 主链。"));
        assert!(markdown.contains("补 UI 回归"));
        assert!(markdown.contains("Lime Maintainer"));

        let reexported =
            export_runtime_review_decision_template(&detail, &thread_read, temp_dir.path())
                .expect("re-export");
        assert_eq!(reexported.decision.decision_status, "accepted");
        assert_eq!(reexported.decision.human_reviewer, "Lime Maintainer");
    }
}
