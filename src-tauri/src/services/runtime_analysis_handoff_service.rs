//! Runtime analysis handoff 导出服务
//!
//! 将 handoff bundle / evidence pack / replay case 重新包装成
//! 外部 Claude Code / Codex 更容易直接消费的 analysis handoff。
//! 这条链仍然只负责导出证据与现成提示词，不在 Lime 内自动分析或自动修复。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use crate::services::runtime_evidence_pack_service::{
    export_runtime_evidence_pack, RuntimeEvidenceArtifactKind, RuntimeEvidencePackExportResult,
};
use crate::services::runtime_handoff_artifact_service::{
    export_runtime_handoff_bundle, RuntimeHandoffArtifactKind, RuntimeHandoffBundleExportResult,
};
use crate::services::runtime_replay_case_service::{
    export_runtime_replay_case, RuntimeReplayArtifactKind, RuntimeReplayCaseExportResult,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const SESSION_RELATIVE_ROOT: &str = ".lime/harness/sessions";
const ANALYSIS_DIR_NAME: &str = "analysis";
const ANALYSIS_BRIEF_FILE_NAME: &str = "analysis-brief.md";
const ANALYSIS_CONTEXT_FILE_NAME: &str = "analysis-context.json";
const DEFAULT_SANITIZED_WORKSPACE_ROOT: &str = "/workspace/lime";
const MAX_EXCERPT_CHARS: usize = 1200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeAnalysisArtifactKind {
    AnalysisBrief,
    AnalysisContext,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAnalysisArtifact {
    pub kind: RuntimeAnalysisArtifactKind,
    pub title: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAnalysisHandoffExportResult {
    pub session_id: String,
    pub thread_id: String,
    pub workspace_id: Option<String>,
    pub workspace_root: String,
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
    pub sanitized_workspace_root: String,
    pub copy_prompt: String,
    pub artifacts: Vec<RuntimeAnalysisArtifact>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisContextDocument {
    schema_version: String,
    source: AnalysisContextSource,
    title: String,
    exported_at: String,
    sanitized_workspace_root: String,
    replay_root: String,
    summary: AnalysisContextSummary,
    replay: AnalysisReplaySection,
    handoff: AnalysisHandoffSection,
    evidence: AnalysisEvidenceSection,
    reading_order: Vec<String>,
    external_analysis_contract: AnalysisExternalContract,
    human_review_checklist: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisContextSource {
    contract_shape: String,
    derived_from: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisContextSummary {
    session_id: String,
    thread_id: String,
    execution_strategy: String,
    model: String,
    goal_summary: String,
    latest_turn_status: String,
    thread_status: String,
    primary_blocking_kind: String,
    primary_blocking_summary: String,
    failure_modes: Vec<String>,
    suite_tags: Vec<String>,
    pending_request_count: usize,
    queued_turn_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisArtifactReference {
    kind: String,
    title: String,
    relative_path: String,
    absolute_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisReplaySection {
    artifacts: Vec<AnalysisArtifactReference>,
    grader_excerpt: String,
    input: Value,
    expected: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisHandoffSection {
    artifacts: Vec<AnalysisArtifactReference>,
    progress: Value,
    handoff_excerpt: String,
    review_summary_excerpt: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisEvidenceSection {
    artifacts: Vec<AnalysisArtifactReference>,
    runtime: Value,
    summary_excerpt: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisExternalContract {
    audience: String,
    task: String,
    required_sections: Vec<String>,
    rules: Vec<String>,
}

pub fn export_runtime_analysis_handoff(
    detail: &SessionDetail,
    thread_read: &AgentRuntimeThreadReadModel,
    workspace_root: &Path,
) -> Result<RuntimeAnalysisHandoffExportResult, String> {
    let session_id = detail.id.trim();
    if session_id.is_empty() {
        return Err("session_id 不能为空，无法导出 analysis handoff".to_string());
    }

    let thread_id = detail.thread_id.trim();
    if thread_id.is_empty() {
        return Err("thread_id 不能为空，无法导出 analysis handoff".to_string());
    }

    let workspace_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let exported_at = Utc::now().to_rfc3339();
    let analysis_relative_root =
        format!("{SESSION_RELATIVE_ROOT}/{session_id}/{ANALYSIS_DIR_NAME}");
    let analysis_absolute_root =
        workspace_root.join(analysis_relative_root.replace('/', std::path::MAIN_SEPARATOR_STR));

    let handoff_bundle =
        export_runtime_handoff_bundle(detail, thread_read, workspace_root.as_path())?;
    let evidence_pack =
        export_runtime_evidence_pack(detail, thread_read, workspace_root.as_path())?;
    let replay_case = export_runtime_replay_case(detail, thread_read, workspace_root.as_path())?;

    fs::create_dir_all(&analysis_absolute_root).map_err(|error| {
        format!(
            "创建 analysis handoff 目录失败 {}: {error}",
            analysis_absolute_root.display()
        )
    })?;

    let replay_root = PathBuf::from(&replay_case.replay_absolute_root);
    let session_root = PathBuf::from(&handoff_bundle.bundle_absolute_root);
    let evidence_root = PathBuf::from(&evidence_pack.pack_absolute_root);

    let input_payload = read_json_file(&replay_root.join("input.json"))?;
    let expected_payload = read_json_file(&replay_root.join("expected.json"))?;
    let progress_payload = read_json_file(&session_root.join("progress.json"))?;
    let runtime_payload = read_json_file(&evidence_root.join("runtime.json"))?;
    let grader_excerpt = truncate_text(
        &read_text_file(&replay_root.join("grader.md"))?,
        MAX_EXCERPT_CHARS,
    );
    let handoff_excerpt = truncate_text(
        &read_optional_text_file(&session_root.join("handoff.md"))?,
        MAX_EXCERPT_CHARS,
    );
    let review_summary_excerpt = truncate_text(
        &read_optional_text_file(&session_root.join("review-summary.md"))?,
        MAX_EXCERPT_CHARS,
    );
    let evidence_summary_excerpt = truncate_text(
        &read_optional_text_file(&evidence_root.join("summary.md"))?,
        MAX_EXCERPT_CHARS,
    );

    let title = derive_title(&input_payload, session_id);
    let failure_modes = value_string_list(
        input_payload
            .pointer("/classification/failureModes")
            .unwrap_or(&Value::Null),
    );
    let suite_tags = value_string_list(
        input_payload
            .pointer("/classification/suiteTags")
            .unwrap_or(&Value::Null),
    );
    let primary_blocking_kind = value_string(
        input_payload
            .pointer("/classification/primaryBlockingKind")
            .unwrap_or(&Value::Null),
    )
    .or_else(|| {
        thread_read
            .diagnostics
            .as_ref()
            .and_then(|value| normalize_optional_text(value.primary_blocking_kind.clone()))
    })
    .unwrap_or_default();
    let primary_blocking_summary = value_string(
        input_payload
            .pointer("/task/primaryBlockingSummary")
            .unwrap_or(&Value::Null),
    )
    .or_else(|| {
        thread_read
            .diagnostics
            .as_ref()
            .and_then(|value| normalize_optional_text(value.primary_blocking_summary.clone()))
    })
    .unwrap_or_default();

    let replay_refs = replay_case
        .artifacts
        .iter()
        .map(|artifact| AnalysisArtifactReference {
            kind: replay_artifact_kind_key(&artifact.kind).to_string(),
            title: artifact.title.clone(),
            relative_path: artifact.relative_path.clone(),
            absolute_path: sanitize_absolute_path_for_external_use(
                Path::new(&artifact.absolute_path),
                workspace_root.as_path(),
                DEFAULT_SANITIZED_WORKSPACE_ROOT,
            ),
        })
        .collect::<Vec<_>>();
    let handoff_refs = handoff_bundle
        .artifacts
        .iter()
        .map(|artifact| AnalysisArtifactReference {
            kind: handoff_artifact_kind_key(&artifact.kind).to_string(),
            title: artifact.title.clone(),
            relative_path: artifact.relative_path.clone(),
            absolute_path: sanitize_absolute_path_for_external_use(
                Path::new(&artifact.absolute_path),
                workspace_root.as_path(),
                DEFAULT_SANITIZED_WORKSPACE_ROOT,
            ),
        })
        .collect::<Vec<_>>();
    let evidence_refs = evidence_pack
        .artifacts
        .iter()
        .map(|artifact| AnalysisArtifactReference {
            kind: evidence_artifact_kind_key(&artifact.kind).to_string(),
            title: artifact.title.clone(),
            relative_path: artifact.relative_path.clone(),
            absolute_path: sanitize_absolute_path_for_external_use(
                Path::new(&artifact.absolute_path),
                workspace_root.as_path(),
                DEFAULT_SANITIZED_WORKSPACE_ROOT,
            ),
        })
        .collect::<Vec<_>>();

    let summary = AnalysisContextSummary {
        session_id: session_id.to_string(),
        thread_id: thread_id.to_string(),
        execution_strategy: value_string(
            input_payload
                .pointer("/session/executionStrategy")
                .unwrap_or(&Value::Null),
        )
        .or_else(|| normalize_optional_text(detail.execution_strategy.clone()))
        .unwrap_or_default(),
        model: value_string(
            input_payload
                .pointer("/session/model")
                .unwrap_or(&Value::Null),
        )
        .or_else(|| normalize_optional_text(detail.model.clone()))
        .unwrap_or_default(),
        goal_summary: value_string(
            input_payload
                .pointer("/task/goalSummary")
                .unwrap_or(&Value::Null),
        )
        .unwrap_or_default(),
        latest_turn_status: value_string(
            input_payload
                .pointer("/task/latestTurnStatus")
                .unwrap_or(&Value::Null),
        )
        .or_else(|| {
            thread_read
                .diagnostics
                .as_ref()
                .and_then(|value| normalize_optional_text(value.latest_turn_status.clone()))
        })
        .unwrap_or_default(),
        thread_status: value_string(
            input_payload
                .pointer("/task/threadStatus")
                .unwrap_or(&Value::Null),
        )
        .unwrap_or_else(|| thread_read.status.clone()),
        primary_blocking_kind,
        primary_blocking_summary,
        failure_modes: failure_modes.clone(),
        suite_tags: suite_tags.clone(),
        pending_request_count: thread_read.pending_requests.len(),
        queued_turn_count: thread_read.queued_turns.len(),
    };

    let reading_order = build_reading_order();
    let review_checklist =
        build_human_review_checklist(&input_payload, &expected_payload, &failure_modes);
    let external_contract = build_external_analysis_contract();

    let analysis_context = AnalysisContextDocument {
        schema_version: "v1".to_string(),
        source: AnalysisContextSource {
            contract_shape: "lime_external_analysis_handoff".to_string(),
            derived_from: vec![
                "lime_workspace_handoff_bundle".to_string(),
                "lime_workspace_evidence_pack".to_string(),
                "lime_runtime_export_replay_case".to_string(),
            ],
        },
        title: title.clone(),
        exported_at: exported_at.clone(),
        sanitized_workspace_root: DEFAULT_SANITIZED_WORKSPACE_ROOT.to_string(),
        replay_root: sanitize_absolute_path_for_external_use(
            replay_root.as_path(),
            workspace_root.as_path(),
            DEFAULT_SANITIZED_WORKSPACE_ROOT,
        ),
        summary: summary.clone(),
        replay: AnalysisReplaySection {
            artifacts: replay_refs.clone(),
            grader_excerpt: sanitize_text(grader_excerpt, workspace_root.as_path()),
            input: sanitize_value(input_payload, workspace_root.as_path()),
            expected: sanitize_value(expected_payload, workspace_root.as_path()),
        },
        handoff: AnalysisHandoffSection {
            artifacts: handoff_refs.clone(),
            progress: sanitize_value(progress_payload, workspace_root.as_path()),
            handoff_excerpt: sanitize_text(handoff_excerpt, workspace_root.as_path()),
            review_summary_excerpt: sanitize_text(review_summary_excerpt, workspace_root.as_path()),
        },
        evidence: AnalysisEvidenceSection {
            artifacts: evidence_refs.clone(),
            runtime: sanitize_value(runtime_payload, workspace_root.as_path()),
            summary_excerpt: sanitize_text(evidence_summary_excerpt, workspace_root.as_path()),
        },
        reading_order: reading_order.clone(),
        external_analysis_contract: external_contract.clone(),
        human_review_checklist: review_checklist.clone(),
    };

    let analysis_brief = build_analysis_brief(
        &title,
        &exported_at,
        &summary,
        &replay_refs,
        &handoff_refs,
        &evidence_refs,
        &reading_order,
        &review_checklist,
        &analysis_context.replay.grader_excerpt,
        &analysis_context.handoff.handoff_excerpt,
        &analysis_context.evidence.summary_excerpt,
    );

    let artifacts = vec![
        write_analysis_file(
            &analysis_absolute_root,
            session_id,
            ANALYSIS_BRIEF_FILE_NAME,
            RuntimeAnalysisArtifactKind::AnalysisBrief,
            "外部分析简报",
            analysis_brief,
        )?,
        write_analysis_file(
            &analysis_absolute_root,
            session_id,
            ANALYSIS_CONTEXT_FILE_NAME,
            RuntimeAnalysisArtifactKind::AnalysisContext,
            "外部分析上下文",
            format!(
                "{}\n",
                serde_json::to_string_pretty(&analysis_context)
                    .map_err(|error| format!("序列化 analysis context 失败: {error}"))?
            ),
        )?,
    ];

    let copy_prompt = build_copy_prompt(
        &title,
        &summary,
        &artifacts,
        &handoff_bundle,
        &evidence_pack,
        &replay_case,
    );

    Ok(RuntimeAnalysisHandoffExportResult {
        session_id: session_id.to_string(),
        thread_id: thread_id.to_string(),
        workspace_id: normalize_optional_text(detail.workspace_id.clone()),
        workspace_root: workspace_root.to_string_lossy().to_string(),
        analysis_relative_root,
        analysis_absolute_root: analysis_absolute_root.to_string_lossy().to_string(),
        handoff_bundle_relative_root: handoff_bundle.bundle_relative_root,
        evidence_pack_relative_root: evidence_pack.pack_relative_root,
        replay_case_relative_root: replay_case.replay_relative_root,
        exported_at,
        title,
        thread_status: thread_read.status.clone(),
        latest_turn_status: thread_read
            .diagnostics
            .as_ref()
            .and_then(|value| normalize_optional_text(value.latest_turn_status.clone())),
        pending_request_count: thread_read.pending_requests.len(),
        queued_turn_count: thread_read.queued_turns.len(),
        sanitized_workspace_root: DEFAULT_SANITIZED_WORKSPACE_ROOT.to_string(),
        copy_prompt,
        artifacts,
    })
}

fn build_analysis_brief(
    title: &str,
    exported_at: &str,
    summary: &AnalysisContextSummary,
    replay_refs: &[AnalysisArtifactReference],
    handoff_refs: &[AnalysisArtifactReference],
    evidence_refs: &[AnalysisArtifactReference],
    reading_order: &[String],
    review_checklist: &[String],
    grader_excerpt: &str,
    handoff_excerpt: &str,
    evidence_excerpt: &str,
) -> String {
    let mut lines = vec![
        "# 外部分析交接简报".to_string(),
        String::new(),
        format!("- 标题：{title}"),
        format!("- 生成时间：{exported_at}"),
        format!("- 会话：`{}`", summary.session_id),
        format!("- 线程：`{}`", summary.thread_id),
        format!(
            "- 执行策略：{}",
            empty_fallback(&summary.execution_strategy, "unknown")
        ),
        format!("- 模型：{}", empty_fallback(&summary.model, "unknown")),
        String::new(),
        "## 当前问题".to_string(),
        String::new(),
        format!(
            "- 目标摘要：{}",
            empty_fallback(&summary.goal_summary, "未知")
        ),
        format!(
            "- 线程状态：{}",
            empty_fallback(&summary.thread_status, "未知")
        ),
        format!(
            "- 最新 turn 状态：{}",
            empty_fallback(&summary.latest_turn_status, "未知")
        ),
        format!(
            "- 主要阻塞：{}{}",
            empty_fallback(&summary.primary_blocking_kind, "未知"),
            if summary.primary_blocking_summary.is_empty() {
                String::new()
            } else {
                format!(" · {}", summary.primary_blocking_summary)
            }
        ),
        format!(
            "- failure modes：{}",
            join_or_fallback(&summary.failure_modes, "无")
        ),
        format!(
            "- suite tags：{}",
            join_or_fallback(&summary.suite_tags, "无")
        ),
        format!("- pending request：{}", summary.pending_request_count),
        format!("- queued turn：{}", summary.queued_turn_count),
        String::new(),
        "## 推荐读取顺序".to_string(),
        String::new(),
    ];

    for (index, item) in reading_order.iter().enumerate() {
        lines.push(format!("{}. {}", index + 1, item));
    }

    lines.extend([String::new(), "## Replay 文件".to_string(), String::new()]);
    lines.extend(render_artifact_lines(replay_refs));
    lines.extend([String::new(), "## Handoff 文件".to_string(), String::new()]);
    lines.extend(render_artifact_lines(handoff_refs));
    lines.extend([String::new(), "## Evidence 文件".to_string(), String::new()]);
    lines.extend(render_artifact_lines(evidence_refs));
    lines.extend([
        String::new(),
        "## 可直接给外部 AI 的任务说明".to_string(),
        String::new(),
        "```text".to_string(),
        "你将收到一个由 Lime 导出的 analysis handoff。你的职责是先诊断问题，再给出最小可执行修复方案；如果证据已足够明确，也可以直接在工作区内实施修复。".to_string(),
        String::new(),
        "请优先读取 analysis-context.json 与 analysis-brief.md，再按其中给出的 replay / handoff / evidence 顺序继续下钻。".to_string(),
        String::new(),
        "输出至少包含：".to_string(),
        "- 结论".to_string(),
        "- 根因判断".to_string(),
        "- 关键证据".to_string(),
        "- 修复建议".to_string(),
        "- 如果已修改代码，列出改动与回归点".to_string(),
        "- 风险与未知项".to_string(),
        String::new(),
        "约束：".to_string(),
        "- 优先引用现有证据，不要假装看到不存在的信息。".to_string(),
        "- 如果证据不足，明确写出缺口和需要人工确认的地方。".to_string(),
        "- 不顺手扩大到无关重构。".to_string(),
        "```".to_string(),
        String::new(),
        "## 人工审核检查清单".to_string(),
        String::new(),
    ]);
    lines.extend(review_checklist.iter().map(|item| format!("- {item}")));
    lines.extend([
        String::new(),
        "## 关键摘录".to_string(),
        String::new(),
        "### Replay Grader 摘录".to_string(),
        String::new(),
        empty_fallback(grader_excerpt, "当前无可用摘录。").to_string(),
        String::new(),
        "### Handoff 摘录".to_string(),
        String::new(),
        empty_fallback(handoff_excerpt, "当前无可用摘录。").to_string(),
        String::new(),
        "### Evidence 摘录".to_string(),
        String::new(),
        empty_fallback(evidence_excerpt, "当前无可用摘录。").to_string(),
        String::new(),
        "## 注意".to_string(),
        String::new(),
        format!(
            "- 所有路径默认已按 `{DEFAULT_SANITIZED_WORKSPACE_ROOT}` 占位规则输出，便于外部 AI 消费。"
        ),
        "- 这份简报只负责分析交接，不负责 Lime 内部自动修复。".to_string(),
        String::new(),
    ]);

    format!("{}\n", lines.join("\n"))
}

fn build_copy_prompt(
    title: &str,
    summary: &AnalysisContextSummary,
    artifacts: &[RuntimeAnalysisArtifact],
    handoff_bundle: &RuntimeHandoffBundleExportResult,
    evidence_pack: &RuntimeEvidencePackExportResult,
    replay_case: &RuntimeReplayCaseExportResult,
) -> String {
    let analysis_brief_path = artifacts
        .iter()
        .find(|artifact| artifact.kind == RuntimeAnalysisArtifactKind::AnalysisBrief)
        .map(|artifact| to_portable_path(artifact.absolute_path.as_str()))
        .unwrap_or_default();
    let analysis_context_path = artifacts
        .iter()
        .find(|artifact| artifact.kind == RuntimeAnalysisArtifactKind::AnalysisContext)
        .map(|artifact| to_portable_path(artifact.absolute_path.as_str()))
        .unwrap_or_default();

    let lines = vec![
        "# Lime 外部诊断与修复任务".to_string(),
        String::new(),
        "你现在位于一个可读写的 Lime 工作区。请不要向我继续追问额外上下文，直接基于现有证据先诊断问题，再给出最小修复方案；如果证据已经足够明确，也可以直接修改代码完成修复。".to_string(),
        String::new(),
        "请先读取下面两份文件：".to_string(),
        format!("1. `{analysis_brief_path}`"),
        format!("2. `{analysis_context_path}`"),
        String::new(),
        "如果需要继续下钻，再按 analysis brief 里的顺序读取 replay / handoff / evidence 文件。".to_string(),
        String::new(),
        "当前任务摘要：".to_string(),
        format!("- 标题：{title}"),
        format!("- 会话：`{}`", summary.session_id),
        format!("- 线程：`{}`", summary.thread_id),
        format!("- 线程状态：{}", empty_fallback(&summary.thread_status, "未知")),
        format!(
            "- 主要阻塞：{}{}",
            empty_fallback(&summary.primary_blocking_kind, "未知"),
            if summary.primary_blocking_summary.is_empty() {
                String::new()
            } else {
                format!(" · {}", summary.primary_blocking_summary)
            }
        ),
        format!("- Handoff 根目录：`{}`", to_portable_path(&handoff_bundle.bundle_absolute_root)),
        format!("- Evidence 根目录：`{}`", to_portable_path(&evidence_pack.pack_absolute_root)),
        format!("- Replay 根目录：`{}`", to_portable_path(&replay_case.replay_absolute_root)),
        String::new(),
        "输出要求：".to_string(),
        "- 先给出结论与根因判断。".to_string(),
        "- 明确引用关键证据文件，不要凭空推断。".to_string(),
        "- 给出最小修复方案；如果已经修改代码，请列出改动点和原因。".to_string(),
        "- 给出回归建议、风险与未知项。".to_string(),
        String::new(),
        "约束：".to_string(),
        "- 优先做最小修复，不顺手扩大到无关重构。".to_string(),
        "- 如果证据不足，明确列出缺口。".to_string(),
        "- 最终是否接受修复仍由人工审核决定。".to_string(),
        String::new(),
    ];

    format!("{}\n", lines.join("\n"))
}

fn build_reading_order() -> Vec<String> {
    vec![
        "先读 replay/input.json 与 replay/expected.json，确认任务目标与判定标准。".to_string(),
        "再读 handoff/handoff.md 与 handoff/progress.json，确认当前状态、待继续事项与恢复顺序。"
            .to_string(),
        "再读 evidence/summary.md 与 evidence/runtime.json，确认当前阻塞、pending request 与 diagnostics。"
            .to_string(),
        "如需复盘过程，再读 evidence/timeline.json。".to_string(),
        "最后回看 replay/grader.md，按约定输出根因、修复建议、回归建议与风险项。"
            .to_string(),
    ]
}

fn build_external_analysis_contract() -> AnalysisExternalContract {
    AnalysisExternalContract {
        audience: "Claude Code / Codex".to_string(),
        task: "基于 Lime 导出的结构化证据做问题分析与修复建议，不直接代替团队做最终决策。"
            .to_string(),
        required_sections: vec![
            "结论".to_string(),
            "根因判断".to_string(),
            "关键证据".to_string(),
            "修复建议".to_string(),
            "回归建议".to_string(),
            "风险与未知项".to_string(),
        ],
        rules: vec![
            "优先引用现有证据文件，不要求重建完整会话。".to_string(),
            "如果证据不足，显式列出缺口，不要假装已经确认。".to_string(),
            "只给分析与建议，不直接替团队批准或拒绝修复方案。".to_string(),
            "如果怀疑路径、凭证或外部系统状态影响结论，先标注为待人工复核。".to_string(),
        ],
    }
}

fn build_human_review_checklist(
    input_payload: &Value,
    expected_payload: &Value,
    failure_modes: &[String],
) -> Vec<String> {
    let mut checklist = vec![
        "确认外部 AI 是否引用了现有证据，而不是凭空推断。".to_string(),
        "确认修复建议是否直接服务当前失败模式，而不是顺手扩大范围。".to_string(),
        "确认回归建议是否能沉淀为 replay / eval / smoke，而不是停留在口头建议。".to_string(),
    ];

    let requires_human_review = expected_payload
        .pointer("/graderSuggestion/requiresHumanReview")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if requires_human_review {
        checklist.insert(
            0,
            "当前样本本来就要求人工复核，不应把外部 AI 结论当成最终裁决。".to_string(),
        );
    }

    if failure_modes.iter().any(|mode| mode == "pending_request")
        || !value_array(
            input_payload
                .pointer("/runtimeContext/pendingRequests")
                .unwrap_or(&Value::Null),
        )
        .is_empty()
    {
        checklist.push("确认外部 AI 没有把 pending request 误判成已完成。".to_string());
    }

    checklist
}

fn handoff_artifact_kind_key(kind: &RuntimeHandoffArtifactKind) -> &'static str {
    match kind {
        RuntimeHandoffArtifactKind::Plan => "plan",
        RuntimeHandoffArtifactKind::Progress => "progress",
        RuntimeHandoffArtifactKind::Handoff => "handoff",
        RuntimeHandoffArtifactKind::ReviewSummary => "review_summary",
    }
}

fn evidence_artifact_kind_key(kind: &RuntimeEvidenceArtifactKind) -> &'static str {
    match kind {
        RuntimeEvidenceArtifactKind::Summary => "summary",
        RuntimeEvidenceArtifactKind::Runtime => "runtime",
        RuntimeEvidenceArtifactKind::Timeline => "timeline",
        RuntimeEvidenceArtifactKind::Artifacts => "artifacts",
    }
}

fn replay_artifact_kind_key(kind: &RuntimeReplayArtifactKind) -> &'static str {
    match kind {
        RuntimeReplayArtifactKind::Input => "input",
        RuntimeReplayArtifactKind::Expected => "expected",
        RuntimeReplayArtifactKind::Grader => "grader",
        RuntimeReplayArtifactKind::EvidenceLinks => "evidence_links",
    }
}

fn write_analysis_file(
    analysis_root: &Path,
    session_id: &str,
    file_name: &str,
    kind: RuntimeAnalysisArtifactKind,
    title: &str,
    content: String,
) -> Result<RuntimeAnalysisArtifact, String> {
    let absolute_path = analysis_root.join(file_name);
    fs::write(&absolute_path, content.as_bytes()).map_err(|error| {
        format!(
            "写入 analysis handoff 文件失败 {}: {error}",
            absolute_path.display()
        )
    })?;

    Ok(RuntimeAnalysisArtifact {
        kind,
        title: title.to_string(),
        relative_path: format!(
            "{SESSION_RELATIVE_ROOT}/{session_id}/{ANALYSIS_DIR_NAME}/{file_name}"
        ),
        absolute_path: absolute_path.to_string_lossy().to_string(),
        bytes: content.len(),
    })
}

fn derive_title(input_payload: &Value, session_id: &str) -> String {
    value_string(
        input_payload
            .pointer("/task/goalSummary")
            .unwrap_or(&Value::Null),
    )
    .unwrap_or_else(|| format!("外部分析交接 / {session_id}"))
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("读取 JSON 文件失败 {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("解析 JSON 文件失败 {}: {error}", path.display()))
}

fn read_text_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path)
        .map_err(|error| format!("读取文本文件失败 {}: {error}", path.display()))
}

fn read_optional_text_file(path: &Path) -> Result<String, String> {
    if !path.exists() {
        return Ok(String::new());
    }
    read_text_file(path)
}

fn sanitize_value(value: Value, workspace_root: &Path) -> Value {
    match value {
        Value::String(text) => Value::String(sanitize_text(text, workspace_root)),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(|entry| sanitize_value(entry, workspace_root))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, entry)| (key, sanitize_value(entry, workspace_root)))
                .collect(),
        ),
        other => other,
    }
}

fn sanitize_text(text: String, workspace_root: &Path) -> String {
    replace_workspace_root_in_string(text, workspace_root, DEFAULT_SANITIZED_WORKSPACE_ROOT)
}

fn replace_workspace_root_in_string(
    text: String,
    workspace_root: &Path,
    placeholder: &str,
) -> String {
    if text.is_empty() {
        return text;
    }

    let raw_root = workspace_root.to_string_lossy().to_string();
    let portable_root = to_portable_path(&raw_root);
    let mut next = text.replace(raw_root.as_str(), placeholder);
    if portable_root != raw_root {
        next = next.replace(portable_root.as_str(), placeholder);
    }
    if next.contains(placeholder) {
        next = next.replace('\\', "/");
    }
    next
}

fn sanitize_absolute_path_for_external_use(
    absolute_path: &Path,
    workspace_root: &Path,
    placeholder: &str,
) -> String {
    match absolute_path.strip_prefix(workspace_root) {
        Ok(relative_path) => to_portable_path(
            Path::new(placeholder)
                .join(relative_path)
                .to_string_lossy()
                .as_ref(),
        ),
        Err(_) => String::new(),
    }
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    trimmed.chars().take(max_chars).collect::<String>() + "…"
}

fn render_artifact_lines(entries: &[AnalysisArtifactReference]) -> Vec<String> {
    if entries.is_empty() {
        return vec!["- 当前未检测到可用文件。".to_string()];
    }

    entries
        .iter()
        .map(|entry| {
            if entry.absolute_path.is_empty() {
                format!("- `{}`", entry.relative_path)
            } else {
                format!("- `{}`  ({})", entry.relative_path, entry.absolute_path)
            }
        })
        .collect()
}

fn value_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn value_string_list(value: &Value) -> Vec<String> {
    match value {
        Value::Array(values) => values.iter().filter_map(value_string).collect(),
        _ => Vec::new(),
    }
}

fn value_array(value: &Value) -> Vec<Value> {
    value.as_array().cloned().unwrap_or_default()
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn join_or_fallback(values: &[String], fallback: &str) -> String {
    if values.is_empty() {
        fallback.to_string()
    } else {
        values.join(", ")
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
        AgentRuntimeThreadDiagnostics, AgentRuntimeThreadReadModel,
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
            name: "Harness Demo".to_string(),
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
                prompt_text: "请把当前 pending request 会话导成分析交接包。".to_string(),
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
                        text: "补 analysis handoff GUI 入口".to_string(),
                    },
                },
                AgentThreadItem {
                    id: "item-artifact-1".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    sequence: 2,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-27T10:00:20Z".to_string(),
                    completed_at: Some("2026-03-27T10:00:20Z".to_string()),
                    updated_at: "2026-03-27T10:00:20Z".to_string(),
                    payload: AgentThreadItemPayload::FileArtifact {
                        path: ".lime/artifacts/thread-1/analysis-gap.md".to_string(),
                        source: "artifact_snapshot".to_string(),
                        content: None,
                        metadata: None,
                    },
                },
                AgentThreadItem {
                    id: "item-summary-1".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    sequence: 3,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-27T10:01:00Z".to_string(),
                    completed_at: Some("2026-03-27T10:01:00Z".to_string()),
                    updated_at: "2026-03-27T10:01:00Z".to_string(),
                    payload: AgentThreadItemPayload::TurnSummary {
                        text: "已完成 handoff / evidence / replay，下一步把问题交给外部 AI 诊断并修复。"
                            .to_string(),
                    },
                },
            ],
            todo_items: vec![lime_agent::SessionTodoItem {
                content: "补分析交接 GUI 入口".to_string(),
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
                title: Some("允许写入 analysis 目录".to_string()),
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
                message_preview: "继续补 HarnessStatusPanel".to_string(),
                message_text: "继续补 HarnessStatusPanel".to_string(),
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
                primary_blocking_summary: Some("等待用户确认 analysis 导出".to_string()),
                latest_warning: None,
                latest_context_compaction: None,
                latest_failed_tool: None,
                latest_failed_command: None,
                latest_pending_request: Some(AgentRuntimeDiagnosticPendingRequestSample {
                    request_id: "req-1".to_string(),
                    turn_id: Some("turn-1".to_string()),
                    request_type: "approval_request".to_string(),
                    title: Some("允许写入 analysis 目录".to_string()),
                    waited_seconds: Some(10),
                    created_at: None,
                }),
            }),
        }
    }

    #[test]
    fn should_export_runtime_analysis_handoff_to_workspace() {
        let temp_dir = TempDir::new().expect("temp dir");
        let detail = build_detail();
        let thread_read = build_thread_read();

        let result = export_runtime_analysis_handoff(&detail, &thread_read, temp_dir.path())
            .expect("export");

        assert_eq!(
            result.analysis_relative_root,
            ".lime/harness/sessions/session-1/analysis"
        );
        assert_eq!(result.artifacts.len(), 2);
        assert_eq!(result.pending_request_count, 1);
        assert!(result.copy_prompt.contains("外部诊断与修复任务"));
        assert!(result.copy_prompt.contains("analysis-brief.md"));
        assert!(result.copy_prompt.contains("analysis-context.json"));

        let brief_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/analysis/analysis-brief.md");
        let context_path = temp_dir
            .path()
            .join(".lime/harness/sessions/session-1/analysis/analysis-context.json");

        assert!(brief_path.exists());
        assert!(context_path.exists());

        let brief = fs::read_to_string(brief_path).expect("brief");
        assert!(brief.contains("外部分析交接简报"));
        assert!(brief.contains("pending request：1"));
        assert!(brief.contains("/workspace/lime"));

        let context = fs::read_to_string(context_path).expect("context");
        assert!(context.contains("\"schemaVersion\": \"v1\""));
        assert!(context.contains("\"contractShape\": \"lime_external_analysis_handoff\""));
        assert!(context.contains("\"pendingRequestCount\": 1"));
        assert!(context.contains("/workspace/lime"));
        assert!(!context.contains(temp_dir.path().to_string_lossy().as_ref()));
    }
}
