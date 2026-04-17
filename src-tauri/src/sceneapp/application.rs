use super::adapters::{
    build_sceneapp_automation_draft, build_sceneapp_automation_result,
    build_sceneapp_run_summary_from_agent_run_with_db,
    build_sceneapp_run_summary_from_automation_job, extract_sceneapp_id_from_automation_job,
    extract_sceneapp_id_from_run_metadata, prepare_sceneapp_run_governance_artifact,
};
use super::catalog::{get_sceneapp_descriptor, seeded_sceneapp_catalog};
use super::context::compiler::build_reference_library_items;
use super::context::dto::{ReferenceItem, TasteProfile};
use super::context::store::{
    build_persisted_sceneapp_context, load_persisted_sceneapp_context,
    save_persisted_sceneapp_context, PersistedSceneAppContext,
};
use super::dto::*;
use super::governance::build_sceneapp_scorecard_from_runs;
use super::runtime::build_launch_plan;
use crate::commands::unified_memory_cmd::load_unified_memories_by_ids;
use crate::database::DbConnection;
use crate::services::automation_service::AutomationService;
use crate::services::execution_tracker_service::ExecutionTracker;
use crate::services::runtime_review_decision_service::RuntimeReviewDecisionContent;
use chrono::Utc;
use std::collections::BTreeSet;

pub struct SceneAppService;

const SCENEAPP_TRACKER_RUN_LIMIT: usize = 200;

fn sort_and_dedupe_runs(runs: &mut Vec<SceneAppRunSummary>) {
    runs.sort_by(|left, right| {
        right
            .started_at
            .cmp(&left.started_at)
            .then_with(|| right.run_id.cmp(&left.run_id))
    });
    runs.dedup_by(|left, right| left.run_id == right.run_id);
}

fn normalize_reference_memory_ids(ids: &[String]) -> Vec<String> {
    ids.iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .fold(Vec::<String>::new(), |mut acc, id| {
            if !acc.iter().any(|existing| existing == id) {
                acc.push(id.to_string());
            }
            acc
        })
}

fn load_selected_reference_items(
    db: &DbConnection,
    ids: &[String],
) -> Result<Vec<ReferenceItem>, String> {
    let normalized_ids = normalize_reference_memory_ids(ids);
    if normalized_ids.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db
        .lock()
        .map_err(|error| format!("数据库锁定失败: {error}"))?;
    let memories = load_unified_memories_by_ids(&conn, normalized_ids.as_slice())?;
    Ok(build_reference_library_items(memories.as_slice()))
}

fn build_sceneapp_plan_result(
    db: &DbConnection,
    intent: &SceneAppLaunchIntent,
) -> Result<SceneAppPlanResult, String> {
    let sceneapp_id = intent.sceneapp_id.clone();
    let workspace_id = intent.workspace_id.clone();
    let project_id = intent.project_id.clone();
    let requested_reference_memory_count =
        normalize_reference_memory_ids(intent.reference_memory_ids.as_slice()).len();
    let descriptor = get_sceneapp_descriptor(sceneapp_id.as_str())
        .ok_or_else(|| format!("未找到 SceneApp: {sceneapp_id}"))?;

    let persisted_context = match load_persisted_sceneapp_context(
        db,
        sceneapp_id.as_str(),
        workspace_id.as_deref(),
        project_id.as_deref(),
    ) {
        Ok(context) => context,
        Err(error) => {
            let mut result = build_launch_plan(descriptor, intent.clone(), None, &[]);
            result.plan.warnings.push(format!(
                "读取项目级 Context Snapshot 失败，本次先按最新输入继续 planning：{error}"
            ));
            return Ok(result);
        }
    };

    let explicit_reference_items =
        match load_selected_reference_items(db, intent.reference_memory_ids.as_slice()) {
            Ok(items) => items,
            Err(error) => {
                let mut result =
                    build_launch_plan(descriptor, intent.clone(), persisted_context.as_ref(), &[]);
                result.plan.warnings.push(format!(
                    "读取灵感库参考失败，本次先按当前输入继续 planning：{error}"
                ));
                return Ok(result);
            }
        };

    let mut result = build_launch_plan(
        descriptor,
        intent.clone(),
        persisted_context.as_ref(),
        explicit_reference_items.as_slice(),
    );
    let missing_reference_count =
        requested_reference_memory_count.saturating_sub(explicit_reference_items.len());
    if missing_reference_count > 0 {
        result.plan.warnings.push(format!(
            "已选中的 {} 条灵感条目未找到，planning 仅继续使用当前可解析的参考。",
            missing_reference_count
        ));
    }

    Ok(result)
}

fn normalize_optional_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn run_feedback_timestamp(run: &SceneAppRunSummary) -> &str {
    run.finished_at
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(run.started_at.as_str())
}

fn should_sync_feedback_from_run(run: &SceneAppRunSummary) -> bool {
    matches!(
        run.status,
        SceneAppRunStatus::Success
            | SceneAppRunStatus::Error
            | SceneAppRunStatus::Canceled
            | SceneAppRunStatus::Timeout
    ) || run.artifact_count > 0
        || run.failure_signal.is_some()
        || !run.evidence_known_gaps.is_empty()
        || !run.verification_failure_outcomes.is_empty()
}

fn failure_signal_label(signal: &str) -> &str {
    match signal {
        "pack_incomplete" => "整包不完整",
        "review_blocked" => "复核阻塞",
        "publish_stalled" => "发布卡点",
        "automation_timeout" => "自动化超时",
        "dependency_failure" => "外部依赖与会话稳定性",
        "adoption_failure" => "人工中断与补参",
        "runtime_failure" => "运行链稳定性",
        "artifact_validation_issue" => "结果结构校验问题",
        "telemetry_missing" => "请求遥测缺失",
        "runtime_evidence_gap" => "会话证据缺口",
        "verification_failure" => "结果校验失败",
        _ => signal,
    }
}

fn recommended_action_label(action: &SceneAppRecommendedAction) -> &'static str {
    match action {
        SceneAppRecommendedAction::Launch => "继续补样本",
        SceneAppRecommendedAction::Keep => "继续保留",
        SceneAppRecommendedAction::Optimize => "优先优化",
        SceneAppRecommendedAction::Retire => "考虑收口",
    }
}

fn build_reference_feedback_label(
    run: &SceneAppRunSummary,
    scorecard: Option<&SceneAppScorecard>,
) -> String {
    if let Some(signal) = run
        .failure_signal
        .as_deref()
        .or_else(|| scorecard.and_then(|item| item.top_failure_signal.as_deref()))
    {
        return failure_signal_label(signal).to_string();
    }

    if let Some(scorecard) = scorecard {
        return recommended_action_label(&scorecard.recommended_action).to_string();
    }

    match run.status {
        SceneAppRunStatus::Success => "可继续复用".to_string(),
        SceneAppRunStatus::Canceled => "人工中断".to_string(),
        SceneAppRunStatus::Timeout => "运行超时".to_string(),
        SceneAppRunStatus::Error => "运行受阻".to_string(),
        SceneAppRunStatus::Queued => "等待执行".to_string(),
        SceneAppRunStatus::Running => "运行中".to_string(),
    }
}

fn push_feedback_signal(signals: &mut BTreeSet<String>, value: Option<&str>) {
    let Some(value) = normalize_optional_id(value) else {
        return;
    };
    signals.insert(value);
}

fn collect_feedback_signals(
    run: &SceneAppRunSummary,
    scorecard: Option<&SceneAppScorecard>,
) -> Vec<String> {
    let mut signals = BTreeSet::new();
    push_feedback_signal(&mut signals, run.failure_signal.as_deref());
    push_feedback_signal(
        &mut signals,
        scorecard.and_then(|item| item.top_failure_signal.as_deref()),
    );

    if let Some(scorecard) = scorecard {
        for signal in scorecard.observed_failure_signals.iter() {
            push_feedback_signal(&mut signals, Some(signal.as_str()));
        }
    }

    if run.artifact_validator_issue_count.unwrap_or(0) > 0 {
        signals.insert("artifact_validation_issue".to_string());
    }
    if run.request_telemetry_available == Some(false) {
        signals.insert("telemetry_missing".to_string());
    }
    if !run.evidence_known_gaps.is_empty() {
        signals.insert("runtime_evidence_gap".to_string());
    }
    if !run.verification_failure_outcomes.is_empty() {
        signals.insert("verification_failure".to_string());
    }
    if run.failure_signal.is_none() && !run.delivery_missing_parts.is_empty() {
        signals.insert("pack_incomplete".to_string());
    }

    signals.into_iter().collect()
}

fn build_feedback_summary(
    run: &SceneAppRunSummary,
    scorecard: Option<&SceneAppScorecard>,
) -> String {
    let delivery_sentence =
        if run.delivery_part_coverage_known && !run.delivery_required_parts.is_empty() {
            let delivered = run.delivery_completed_parts.len();
            let total = run.delivery_required_parts.len();
            if run.delivery_missing_parts.is_empty() {
                format!("最近一次运行已交齐 {delivered}/{total} 个必含部件。")
            } else {
                format!("最近一次运行已交付 {delivered}/{total} 个必含部件。")
            }
        } else if run.artifact_count > 0 {
            format!("最近一次运行已回流 {} 份结果。", run.artifact_count)
        } else {
            "最近一次运行还没有回流可复盘结果。".to_string()
        };

    let failure_sentence = if let Some(signal) = run
        .failure_signal
        .as_deref()
        .or_else(|| scorecard.and_then(|item| item.top_failure_signal.as_deref()))
    {
        format!("当前主要卡点是{}。", failure_signal_label(signal))
    } else if !run.evidence_known_gaps.is_empty() {
        "当前仍有会话证据缺口需要补齐。".to_string()
    } else if !run.verification_failure_outcomes.is_empty() {
        "当前仍有结果校验问题需要回头处理。".to_string()
    } else {
        "当前还没有出现明显阻塞。".to_string()
    };

    let action_sentence = scorecard
        .map(|item| {
            format!(
                "经营上建议{}。",
                recommended_action_label(&item.recommended_action)
            )
        })
        .unwrap_or_else(|| match run.status {
            SceneAppRunStatus::Success => "经营上可以继续复用这轮结果。".to_string(),
            SceneAppRunStatus::Canceled => "经营上更适合先确认人工中断原因。".to_string(),
            SceneAppRunStatus::Timeout | SceneAppRunStatus::Error => {
                "经营上更适合先修运行链再继续放大。".to_string()
            }
            SceneAppRunStatus::Queued | SceneAppRunStatus::Running => {
                "经营上先等待这轮运行稳定收口。".to_string()
            }
        });

    format!("{delivery_sentence}{failure_sentence}{action_sentence}")
}

fn normalize_optional_text(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn ensure_feedback_sentence(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if matches!(
        trimmed.chars().last(),
        Some('。' | '！' | '？' | '.' | '!' | '?')
    ) {
        trimmed.to_string()
    } else {
        format!("{trimmed}。")
    }
}

fn review_decision_status_label(status: &str) -> &'static str {
    match status {
        "accepted" => "人工接受",
        "deferred" => "人工延后",
        "rejected" => "人工否决",
        "needs_more_evidence" => "人工补证据",
        "pending_review" => "待人工审核",
        _ => "人工复核",
    }
}

fn review_decision_status_signal(status: &str) -> Option<&'static str> {
    match status {
        "accepted" => Some("review_decision_accepted"),
        "deferred" => Some("review_decision_deferred"),
        "rejected" => Some("review_decision_rejected"),
        "needs_more_evidence" => Some("review_decision_needs_more_evidence"),
        "pending_review" => Some("review_decision_pending_review"),
        _ => None,
    }
}

fn review_decision_risk_label(risk_level: &str) -> Option<&'static str> {
    match risk_level {
        "low" => Some("低风险"),
        "medium" => Some("中风险"),
        "high" => Some("高风险"),
        _ => None,
    }
}

fn review_decision_risk_signal(risk_level: &str) -> Option<&'static str> {
    match risk_level {
        "low" => Some("review_risk_low"),
        "medium" => Some("review_risk_medium"),
        "high" => Some("review_risk_high"),
        _ => None,
    }
}

fn review_decision_feedback_timestamp(
    run: &SceneAppRunSummary,
    decision: &RuntimeReviewDecisionContent,
) -> String {
    decision
        .reviewed_at
        .as_deref()
        .and_then(|value| normalize_optional_text(value))
        .unwrap_or_else(|| run_feedback_timestamp(run).to_string())
}

fn build_review_decision_feedback_label(decision: &RuntimeReviewDecisionContent) -> String {
    let status_label = review_decision_status_label(decision.decision_status.as_str());
    match review_decision_risk_label(decision.risk_level.as_str()) {
        Some(risk_label) => format!("{status_label} · {risk_label}"),
        None => status_label.to_string(),
    }
}

fn collect_review_decision_feedback_signals(
    run: &SceneAppRunSummary,
    decision: &RuntimeReviewDecisionContent,
) -> Vec<String> {
    let mut signals = collect_feedback_signals(run, None)
        .into_iter()
        .collect::<BTreeSet<_>>();
    if let Some(signal) = review_decision_status_signal(decision.decision_status.as_str()) {
        signals.insert(signal.to_string());
    }
    if let Some(signal) = review_decision_risk_signal(decision.risk_level.as_str()) {
        signals.insert(signal.to_string());
    }
    signals.into_iter().collect()
}

fn build_review_decision_feedback_summary(
    run: &SceneAppRunSummary,
    decision: &RuntimeReviewDecisionContent,
) -> String {
    let mut sentences = vec![format!(
        "人工复核结论：{}。",
        build_review_decision_feedback_label(decision)
    )];

    if let Some(summary) = normalize_optional_text(decision.decision_summary.as_str()) {
        sentences.push(ensure_feedback_sentence(summary.as_str()));
    }
    if let Some(strategy) = normalize_optional_text(decision.chosen_fix_strategy.as_str()) {
        sentences.push(format!("处理策略：{}。", strategy));
    }
    if !decision.followup_actions.is_empty() {
        sentences.push(format!(
            "后续动作：{}。",
            decision.followup_actions.join("；")
        ));
    }
    if !decision.regression_requirements.is_empty() {
        sentences.push(format!(
            "回归要求：{}。",
            decision.regression_requirements.join("；")
        ));
    }
    if let Some(reviewer) = normalize_optional_text(decision.human_reviewer.as_str()) {
        sentences.push(format!("审核人：{}。", reviewer));
    }
    if let Some(notes) = normalize_optional_text(decision.notes.as_str()) {
        sentences.push(format!("备注：{}。", notes));
    }
    if let Some(signal) = run.failure_signal.as_deref() {
        sentences.push(format!(
            "这次运行原始卡点：{}。",
            failure_signal_label(signal)
        ));
    }

    sentences.join("")
}

fn resolve_feedback_scope_from_run(run: &SceneAppRunSummary) -> (Option<String>, Option<String>) {
    let project_id = run
        .delivery_artifact_refs
        .iter()
        .find_map(|artifact| normalize_optional_id(artifact.project_id.as_deref()))
        .or_else(|| {
            run.governance_artifact_refs
                .iter()
                .find_map(|artifact| normalize_optional_id(artifact.project_id.as_deref()))
        })
        .or_else(|| {
            run.cloud_scene_runtime_ref
                .as_ref()
                .and_then(|runtime| normalize_optional_id(runtime.project_id.as_deref()))
        })
        .or_else(|| {
            run.native_skill_runtime_ref
                .as_ref()
                .and_then(|runtime| normalize_optional_id(runtime.project_id.as_deref()))
        });

    let workspace_id = run
        .delivery_artifact_refs
        .iter()
        .find_map(|artifact| normalize_optional_id(artifact.workspace_id.as_deref()))
        .or_else(|| {
            run.governance_artifact_refs
                .iter()
                .find_map(|artifact| normalize_optional_id(artifact.workspace_id.as_deref()))
        })
        .or_else(|| {
            run.cloud_scene_runtime_ref
                .as_ref()
                .and_then(|runtime| normalize_optional_id(runtime.workspace_id.as_deref()))
        })
        .or_else(|| {
            run.native_skill_runtime_ref
                .as_ref()
                .and_then(|runtime| normalize_optional_id(runtime.workspace_id.as_deref()))
        });

    (project_id, workspace_id)
}

fn build_default_taste_profile(context: &PersistedSceneAppContext) -> TasteProfile {
    TasteProfile {
        profile_id: format!("taste-{}", context.sceneapp_id),
        summary: "当前 TasteProfile 已根据项目级反馈自动恢复。".to_string(),
        keywords: Vec::new(),
        avoid_keywords: Vec::new(),
        derived_from_reference_ids: context
            .reference_items
            .iter()
            .filter(|item| item.selected)
            .map(|item| item.id.clone())
            .collect(),
        confidence: None,
        feedback_summary: None,
        feedback_signals: Vec::new(),
        last_feedback_at: None,
    }
}

fn apply_run_feedback_to_context(
    context: &mut PersistedSceneAppContext,
    run: &SceneAppRunSummary,
    scorecard: Option<&SceneAppScorecard>,
) -> bool {
    if !should_sync_feedback_from_run(run) {
        return false;
    }

    let feedback_at = run_feedback_timestamp(run).to_string();
    let same_run = context.last_feedback_run_id.as_deref() == Some(run.run_id.as_str());
    let existing_feedback_at = context
        .taste_profile
        .as_ref()
        .and_then(|profile| profile.last_feedback_at.as_deref())
        .filter(|value| !value.trim().is_empty());
    if !same_run && existing_feedback_at.is_some_and(|value| value > feedback_at.as_str()) {
        return false;
    }

    let before = context.clone();
    let derived_reference_ids = context
        .taste_profile
        .as_ref()
        .map(|profile| {
            profile
                .derived_from_reference_ids
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    let feedback_label = build_reference_feedback_label(run, scorecard);

    for item in context.reference_items.iter_mut() {
        let should_update = if !derived_reference_ids.is_empty() {
            derived_reference_ids.contains(item.id.as_str())
        } else {
            item.selected
        };
        if !should_update {
            continue;
        }

        if !same_run {
            item.usage_count = Some(item.usage_count.unwrap_or(0).saturating_add(1));
        }
        item.last_used_at = Some(feedback_at.clone());
        item.last_feedback_label = Some(feedback_label.clone());
    }

    let mut taste_profile = context
        .taste_profile
        .clone()
        .unwrap_or_else(|| build_default_taste_profile(context));
    if taste_profile.derived_from_reference_ids.is_empty() {
        taste_profile.derived_from_reference_ids = context
            .reference_items
            .iter()
            .filter(|item| item.selected)
            .map(|item| item.id.clone())
            .collect();
    }
    if !same_run || scorecard.is_some() || taste_profile.feedback_summary.is_none() {
        taste_profile.feedback_summary = Some(build_feedback_summary(run, scorecard));
        taste_profile.feedback_signals = collect_feedback_signals(run, scorecard);
    }
    taste_profile.last_feedback_at = Some(feedback_at);
    context.taste_profile = Some(taste_profile);
    context.last_feedback_run_id = Some(run.run_id.clone());

    *context != before
}

fn apply_review_decision_to_context(
    context: &mut PersistedSceneAppContext,
    run: &SceneAppRunSummary,
    decision: &RuntimeReviewDecisionContent,
) -> bool {
    if !should_sync_feedback_from_run(run) {
        return false;
    }

    let reviewed_at = review_decision_feedback_timestamp(run, decision);
    let same_run = context.last_feedback_run_id.as_deref() == Some(run.run_id.as_str());
    let existing_feedback_at = context
        .taste_profile
        .as_ref()
        .and_then(|profile| profile.last_feedback_at.as_deref())
        .filter(|value| !value.trim().is_empty());
    if !same_run && existing_feedback_at.is_some_and(|value| value > reviewed_at.as_str()) {
        return false;
    }

    let before = context.clone();
    let _ = apply_run_feedback_to_context(context, run, None);
    let derived_reference_ids = context
        .taste_profile
        .as_ref()
        .map(|profile| {
            profile
                .derived_from_reference_ids
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    let feedback_label = build_review_decision_feedback_label(decision);

    for item in context.reference_items.iter_mut() {
        let should_update = if !derived_reference_ids.is_empty() {
            derived_reference_ids.contains(item.id.as_str())
        } else {
            item.selected
        };
        if !should_update {
            continue;
        }

        item.last_used_at = Some(reviewed_at.clone());
        item.last_feedback_label = Some(feedback_label.clone());
    }

    let mut taste_profile = context
        .taste_profile
        .clone()
        .unwrap_or_else(|| build_default_taste_profile(context));
    if taste_profile.derived_from_reference_ids.is_empty() {
        taste_profile.derived_from_reference_ids = context
            .reference_items
            .iter()
            .filter(|item| item.selected)
            .map(|item| item.id.clone())
            .collect();
    }
    taste_profile.feedback_summary = Some(build_review_decision_feedback_summary(run, decision));
    taste_profile.feedback_signals = collect_review_decision_feedback_signals(run, decision);
    taste_profile.last_feedback_at = Some(reviewed_at);
    context.taste_profile = Some(taste_profile);
    context.last_feedback_run_id = Some(run.run_id.clone());

    *context != before
}

fn sync_persisted_context_feedback(
    db: &DbConnection,
    run: &SceneAppRunSummary,
    scorecard: Option<&SceneAppScorecard>,
) -> Result<Option<PersistedSceneAppContext>, String> {
    let (project_id, workspace_id) = resolve_feedback_scope_from_run(run);
    if project_id.is_none() && workspace_id.is_none() {
        return Ok(None);
    }

    let mut context = load_persisted_sceneapp_context(
        db,
        run.sceneapp_id.as_str(),
        workspace_id.as_deref(),
        project_id.as_deref(),
    )?
    .unwrap_or(PersistedSceneAppContext {
        sceneapp_id: run.sceneapp_id.clone(),
        workspace_id: workspace_id.clone(),
        project_id: project_id.clone(),
        reference_items: Vec::new(),
        taste_profile: None,
        last_feedback_run_id: None,
    });

    if context.workspace_id.is_none() {
        context.workspace_id = workspace_id;
    }
    if context.project_id.is_none() {
        context.project_id = project_id;
    }

    if !apply_run_feedback_to_context(&mut context, run, scorecard) {
        return Ok(Some(context));
    }

    save_persisted_sceneapp_context(db, &context)?;
    Ok(Some(context))
}

fn sync_persisted_context_review_decision(
    db: &DbConnection,
    run: &SceneAppRunSummary,
    decision: &RuntimeReviewDecisionContent,
) -> Result<Option<PersistedSceneAppContext>, String> {
    let (project_id, workspace_id) = resolve_feedback_scope_from_run(run);
    if project_id.is_none() && workspace_id.is_none() {
        return Ok(None);
    }

    let mut context = load_persisted_sceneapp_context(
        db,
        run.sceneapp_id.as_str(),
        workspace_id.as_deref(),
        project_id.as_deref(),
    )?
    .unwrap_or(PersistedSceneAppContext {
        sceneapp_id: run.sceneapp_id.clone(),
        workspace_id: workspace_id.clone(),
        project_id: project_id.clone(),
        reference_items: Vec::new(),
        taste_profile: None,
        last_feedback_run_id: None,
    });

    if context.workspace_id.is_none() {
        context.workspace_id = workspace_id;
    }
    if context.project_id.is_none() {
        context.project_id = project_id;
    }

    if !apply_review_decision_to_context(&mut context, run, decision) {
        return Ok(Some(context));
    }

    save_persisted_sceneapp_context(db, &context)?;
    Ok(Some(context))
}

impl SceneAppService {
    pub fn list_catalog() -> SceneAppCatalog {
        seeded_sceneapp_catalog()
    }

    pub fn get_descriptor(id: &str) -> Option<SceneAppDescriptor> {
        get_sceneapp_descriptor(id)
    }

    pub fn plan_launch(
        db: &DbConnection,
        intent: SceneAppLaunchIntent,
    ) -> Result<SceneAppPlanResult, String> {
        build_sceneapp_plan_result(db, &intent)
    }

    pub fn save_context_baseline(
        db: &DbConnection,
        intent: SceneAppLaunchIntent,
    ) -> Result<SceneAppPlanResult, String> {
        if normalize_optional_id(intent.project_id.as_deref()).is_none()
            && normalize_optional_id(intent.workspace_id.as_deref()).is_none()
        {
            return Err("当前还没有绑定项目工作区，无法写入场景基线。".to_string());
        }

        let sceneapp_id = intent.sceneapp_id.clone();
        let mut result = build_sceneapp_plan_result(db, &intent)?;
        let Some(context_overlay) = result.context_overlay.as_mut() else {
            return Err("当前还没有可写入的场景上下文基线。".to_string());
        };

        let used_at = Utc::now().to_rfc3339();
        for item in context_overlay.snapshot.reference_items.iter_mut() {
            if !item.selected {
                continue;
            }
            item.usage_count = Some(item.usage_count.unwrap_or(0).saturating_add(1));
            item.last_used_at = Some(used_at.clone());
        }
        context_overlay.compiler_plan.notes.push(
            "当前场景基线已写入项目级 Context Snapshot，后续 planning 会优先复用。".to_string(),
        );

        let persisted_context =
            build_persisted_sceneapp_context(sceneapp_id.as_str(), &context_overlay.snapshot);

        match save_persisted_sceneapp_context(db, &persisted_context) {
            Ok(Some(_)) => Ok(result),
            Ok(None) => Err("当前未解析到项目目录，无法写入场景基线。".to_string()),
            Err(error) => Err(format!("写入项目级 Context Snapshot 失败：{error}")),
        }
    }

    fn seeded_runs() -> Vec<SceneAppRunSummary> {
        vec![
            SceneAppRunSummary {
                run_id: "sceneapp-run-story-video-seed".to_string(),
                sceneapp_id: "story-video-suite".to_string(),
                status: SceneAppRunStatus::Success,
                source: "catalog_seed".to_string(),
                source_ref: None,
                session_id: None,
                browser_runtime_ref: None,
                cloud_scene_runtime_ref: None,
                native_skill_runtime_ref: None,
                started_at: "2026-04-15T00:00:00.000Z".to_string(),
                finished_at: Some("2026-04-15T00:08:00.000Z".to_string()),
                artifact_count: 3,
                delivery_artifact_refs: Vec::new(),
                governance_artifact_refs: Vec::new(),
                delivery_required_parts: vec![
                    "brief".to_string(),
                    "storyboard".to_string(),
                    "script".to_string(),
                    "music_refs".to_string(),
                    "video_draft".to_string(),
                    "review_note".to_string(),
                ],
                delivery_completed_parts: vec![
                    "brief".to_string(),
                    "storyboard".to_string(),
                    "script".to_string(),
                ],
                delivery_missing_parts: vec![
                    "music_refs".to_string(),
                    "video_draft".to_string(),
                    "review_note".to_string(),
                ],
                delivery_completion_rate: Some(50.0),
                delivery_part_coverage_known: true,
                failure_signal: Some("review_blocked".to_string()),
                runtime_evidence_used: false,
                evidence_known_gaps: Vec::new(),
                verification_failure_outcomes: Vec::new(),
                request_telemetry_available: None,
                request_telemetry_matched_count: None,
                artifact_validator_applicable: None,
                artifact_validator_issue_count: None,
                artifact_validator_recovered_count: None,
            },
            SceneAppRunSummary {
                run_id: "sceneapp-run-article-export-seed".to_string(),
                sceneapp_id: "x-article-export".to_string(),
                status: SceneAppRunStatus::Queued,
                source: "catalog_seed".to_string(),
                source_ref: None,
                session_id: None,
                browser_runtime_ref: None,
                cloud_scene_runtime_ref: None,
                native_skill_runtime_ref: None,
                started_at: "2026-04-15T00:12:00.000Z".to_string(),
                finished_at: None,
                artifact_count: 0,
                delivery_artifact_refs: Vec::new(),
                governance_artifact_refs: Vec::new(),
                delivery_required_parts: vec!["index.md".to_string(), "meta.json".to_string()],
                delivery_completed_parts: Vec::new(),
                delivery_missing_parts: Vec::new(),
                delivery_completion_rate: None,
                delivery_part_coverage_known: false,
                failure_signal: None,
                runtime_evidence_used: false,
                evidence_known_gaps: Vec::new(),
                verification_failure_outcomes: Vec::new(),
                request_telemetry_available: None,
                request_telemetry_matched_count: None,
                artifact_validator_applicable: None,
                artifact_validator_issue_count: None,
                artifact_validator_recovered_count: None,
            },
        ]
    }

    pub fn list_runs(sceneapp_id: Option<&str>) -> Vec<SceneAppRunSummary> {
        let candidate_runs = Self::seeded_runs();
        let mut runs = match sceneapp_id.map(str::trim).filter(|value| !value.is_empty()) {
            Some(sceneapp_id) => candidate_runs
                .into_iter()
                .filter(|run| run.sceneapp_id == sceneapp_id)
                .collect(),
            None => candidate_runs,
        };
        sort_and_dedupe_runs(&mut runs);
        runs
    }

    pub fn get_run_summary(run_id: &str) -> Option<SceneAppRunSummary> {
        Self::seeded_runs()
            .into_iter()
            .find(|run| run.run_id == run_id.trim())
    }

    pub async fn create_automation_job(
        automation_service: &AutomationService,
        intent: SceneAppAutomationIntent,
    ) -> Result<SceneAppAutomationResult, String> {
        let descriptor = get_sceneapp_descriptor(intent.launch_intent.sceneapp_id.as_str())
            .ok_or_else(|| format!("未找到 SceneApp: {}", intent.launch_intent.sceneapp_id))?;
        let run_now = intent.run_now.unwrap_or(false);
        let draft = build_sceneapp_automation_draft(&descriptor, &intent)?;
        let job = automation_service.create_job(draft)?;
        let run_now_result = if run_now {
            Some(automation_service.run_job_now(job.id.as_str()).await?)
        } else {
            None
        };

        Ok(build_sceneapp_automation_result(
            &descriptor,
            &job,
            run_now_result,
        ))
    }

    pub fn list_runs_from_automation(
        db: &DbConnection,
        automation_service: &AutomationService,
        sceneapp_id: Option<&str>,
    ) -> Result<Vec<SceneAppRunSummary>, String> {
        let sceneapp_id_filter = sceneapp_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let jobs = automation_service.list_jobs()?;
        let mut runs = Vec::new();

        for job in jobs {
            let Some(job_sceneapp_id) = extract_sceneapp_id_from_automation_job(&job) else {
                continue;
            };
            if sceneapp_id_filter
                .as_deref()
                .is_some_and(|value| value != job_sceneapp_id)
            {
                continue;
            }

            let job_runs = automation_service.get_job_runs(job.id.as_str(), 20)?;
            if job_runs.is_empty() {
                let descriptor = get_sceneapp_descriptor(job_sceneapp_id.as_str());
                runs.push(build_sceneapp_run_summary_from_automation_job(
                    &job,
                    descriptor.as_ref(),
                    job_sceneapp_id.clone(),
                ));
                continue;
            }

            runs.extend(job_runs.into_iter().map(|run| {
                let descriptor = get_sceneapp_descriptor(job_sceneapp_id.as_str());
                build_sceneapp_run_summary_from_agent_run_with_db(
                    db,
                    &run,
                    descriptor.as_ref(),
                    job_sceneapp_id.clone(),
                )
            }));
        }

        sort_and_dedupe_runs(&mut runs);
        Ok(runs)
    }

    pub fn list_runs_from_tracker(
        tracker: &ExecutionTracker,
        sceneapp_id: Option<&str>,
    ) -> Result<Vec<SceneAppRunSummary>, String> {
        let sceneapp_id_filter = sceneapp_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let mut runs = tracker
            .list_runs(SCENEAPP_TRACKER_RUN_LIMIT, 0)?
            .into_iter()
            .filter_map(|run| {
                let run_sceneapp_id = extract_sceneapp_id_from_run_metadata(&run)?;
                if sceneapp_id_filter
                    .as_deref()
                    .is_some_and(|value| value != run_sceneapp_id)
                {
                    return None;
                }
                let descriptor = get_sceneapp_descriptor(run_sceneapp_id.as_str());
                Some(build_sceneapp_run_summary_from_agent_run_with_db(
                    tracker.db(),
                    &run,
                    descriptor.as_ref(),
                    run_sceneapp_id,
                ))
            })
            .collect::<Vec<_>>();
        sort_and_dedupe_runs(&mut runs);
        Ok(runs)
    }

    pub fn collect_runs(
        tracker: &ExecutionTracker,
        automation_service: &AutomationService,
        sceneapp_id: Option<&str>,
    ) -> Result<Vec<SceneAppRunSummary>, String> {
        let mut live_runs = Self::list_runs_from_tracker(tracker, sceneapp_id)?;
        live_runs.extend(Self::list_runs_from_automation(
            tracker.db(),
            automation_service,
            sceneapp_id,
        )?);
        sort_and_dedupe_runs(&mut live_runs);

        if !live_runs.is_empty() {
            return Ok(live_runs);
        }

        Ok(Self::list_runs(sceneapp_id))
    }

    pub fn get_run_summary_from_tracker(
        tracker: &ExecutionTracker,
        run_id: &str,
    ) -> Result<Option<SceneAppRunSummary>, String> {
        let Some(run) = tracker.get_run(run_id)? else {
            return Ok(None);
        };
        let Some(sceneapp_id) = extract_sceneapp_id_from_run_metadata(&run) else {
            return Ok(None);
        };
        let descriptor = get_sceneapp_descriptor(sceneapp_id.as_str());
        let summary = build_sceneapp_run_summary_from_agent_run_with_db(
            tracker.db(),
            &run,
            descriptor.as_ref(),
            sceneapp_id,
        );
        let _ = sync_persisted_context_feedback(tracker.db(), &summary, None);
        Ok(Some(summary))
    }

    pub fn prepare_run_governance_artifact(
        tracker: &ExecutionTracker,
        run_id: &str,
        kind: &SceneAppGovernanceArtifactKind,
    ) -> Result<Option<SceneAppRunSummary>, String> {
        let Some(run) = tracker.get_run(run_id)? else {
            return Ok(None);
        };
        let Some(sceneapp_id) = extract_sceneapp_id_from_run_metadata(&run) else {
            return Ok(None);
        };
        prepare_sceneapp_run_governance_artifact(tracker.db(), &run, kind)?;
        let descriptor = get_sceneapp_descriptor(sceneapp_id.as_str());
        let summary = build_sceneapp_run_summary_from_agent_run_with_db(
            tracker.db(),
            &run,
            descriptor.as_ref(),
            sceneapp_id,
        );
        let _ = sync_persisted_context_feedback(tracker.db(), &summary, None);
        Ok(Some(summary))
    }

    pub fn get_scorecard(
        db: &DbConnection,
        automation_service: &AutomationService,
        sceneapp_id: &str,
    ) -> Result<SceneAppScorecard, String> {
        let descriptor = get_sceneapp_descriptor(sceneapp_id)
            .ok_or_else(|| format!("未找到 SceneApp scorecard: {sceneapp_id}"))?;
        let tracker = ExecutionTracker::new(db.clone());
        let runs = Self::collect_runs(&tracker, automation_service, Some(sceneapp_id))?;
        let scorecard = build_sceneapp_scorecard_from_runs(&descriptor, &runs);
        if let Some(run) = runs.iter().find(|run| should_sync_feedback_from_run(run)) {
            let _ = sync_persisted_context_feedback(db, run, Some(&scorecard));
        }
        Ok(scorecard)
    }

    pub fn sync_review_decision_feedback_for_session(
        tracker: &ExecutionTracker,
        session_id: &str,
        decision: &RuntimeReviewDecisionContent,
    ) -> Result<Option<PersistedSceneAppContext>, String> {
        let normalized_session_id = session_id.trim();
        if normalized_session_id.is_empty() {
            return Ok(None);
        }

        let Some(run) = tracker
            .list_runs_by_session(normalized_session_id, SCENEAPP_TRACKER_RUN_LIMIT)?
            .into_iter()
            .find_map(|run| {
                let sceneapp_id = extract_sceneapp_id_from_run_metadata(&run)?;
                let descriptor = get_sceneapp_descriptor(sceneapp_id.as_str());
                Some(build_sceneapp_run_summary_from_agent_run_with_db(
                    tracker.db(),
                    &run,
                    descriptor.as_ref(),
                    sceneapp_id,
                ))
            })
        else {
            return Ok(None);
        };

        sync_persisted_context_review_decision(tracker.db(), &run, decision)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema::create_tables;
    use crate::workspace::{WorkspaceManager, WorkspaceType};
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    fn setup_test_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        Arc::new(Mutex::new(conn))
    }

    fn create_workspace(db: &DbConnection) -> String {
        let temp_dir = tempdir().expect("创建临时目录失败");
        let workspace_root = temp_dir.path().join("sceneapp-feedback-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 根目录失败");
        let workspace = WorkspaceManager::new(db.clone())
            .create_with_type(
                "SceneApp Feedback".to_string(),
                workspace_root,
                WorkspaceType::General,
            )
            .expect("创建 workspace 失败");
        std::mem::forget(temp_dir);
        workspace.id
    }

    fn create_persisted_context(sceneapp_id: &str, workspace_id: &str) -> PersistedSceneAppContext {
        PersistedSceneAppContext {
            sceneapp_id: sceneapp_id.to_string(),
            workspace_id: Some(workspace_id.to_string()),
            project_id: Some(workspace_id.to_string()),
            reference_items: vec![ReferenceItem {
                id: "memory:ref-1".to_string(),
                label: "竞品视频".to_string(),
                source_kind:
                    crate::sceneapp::context::dto::ContextLayerSourceKind::ReferenceLibrary,
                content_type: "video".to_string(),
                uri: None,
                summary: Some("保留强节奏和结论前置。".to_string()),
                selected: true,
                usage_count: None,
                last_used_at: None,
                last_feedback_label: None,
            }],
            taste_profile: Some(TasteProfile {
                profile_id: format!("taste-{sceneapp_id}"),
                summary: "偏好快节奏、强结论。".to_string(),
                keywords: vec!["快节奏".to_string()],
                avoid_keywords: vec!["铺垫过长".to_string()],
                derived_from_reference_ids: vec!["memory:ref-1".to_string()],
                confidence: Some(0.68),
                feedback_summary: None,
                feedback_signals: Vec::new(),
                last_feedback_at: None,
            }),
            last_feedback_run_id: None,
        }
    }

    fn create_run_summary(sceneapp_id: &str, workspace_id: &str) -> SceneAppRunSummary {
        SceneAppRunSummary {
            run_id: "sceneapp-run-feedback-1".to_string(),
            sceneapp_id: sceneapp_id.to_string(),
            status: SceneAppRunStatus::Success,
            source: "automation".to_string(),
            source_ref: Some("job-story-video".to_string()),
            session_id: Some("session-story-video".to_string()),
            browser_runtime_ref: None,
            cloud_scene_runtime_ref: Some(SceneAppCloudSceneRuntimeRef {
                scene_key: Some("story-video".to_string()),
                skill_id: Some("skill-story-video".to_string()),
                project_id: Some(workspace_id.to_string()),
                content_id: None,
                workspace_id: Some(workspace_id.to_string()),
                entry_source: Some("sceneapp_detail_preview".to_string()),
                user_input: Some("生成短视频".to_string()),
                slots: Default::default(),
            }),
            native_skill_runtime_ref: None,
            started_at: "2026-04-17T08:00:00.000Z".to_string(),
            finished_at: Some("2026-04-17T08:02:00.000Z".to_string()),
            artifact_count: 2,
            delivery_artifact_refs: vec![SceneAppDeliveryArtifactRef {
                relative_path: "exports/story-video/brief.md".to_string(),
                absolute_path: None,
                part_key: Some("brief".to_string()),
                project_id: Some(workspace_id.to_string()),
                workspace_id: Some(workspace_id.to_string()),
                source: "runtime_evidence".to_string(),
            }],
            governance_artifact_refs: Vec::new(),
            delivery_required_parts: vec![
                "brief".to_string(),
                "video_draft".to_string(),
                "review_note".to_string(),
            ],
            delivery_completed_parts: vec!["brief".to_string(), "video_draft".to_string()],
            delivery_missing_parts: vec!["review_note".to_string()],
            delivery_completion_rate: Some(66.7),
            delivery_part_coverage_known: true,
            failure_signal: Some("review_blocked".to_string()),
            runtime_evidence_used: true,
            evidence_known_gaps: Vec::new(),
            verification_failure_outcomes: Vec::new(),
            request_telemetry_available: Some(true),
            request_telemetry_matched_count: Some(2),
            artifact_validator_applicable: Some(true),
            artifact_validator_issue_count: Some(1),
            artifact_validator_recovered_count: Some(0),
        }
    }

    fn create_scorecard(sceneapp_id: &str) -> SceneAppScorecard {
        SceneAppScorecard {
            sceneapp_id: sceneapp_id.to_string(),
            updated_at: "2026-04-17T08:05:00.000Z".to_string(),
            summary: "当前更适合优先优化。".to_string(),
            metrics: Vec::new(),
            recommended_action: SceneAppRecommendedAction::Optimize,
            observed_failure_signals: vec!["review_blocked".to_string()],
            top_failure_signal: Some("review_blocked".to_string()),
        }
    }

    #[test]
    fn should_only_preview_context_during_plan_launch() {
        let db = setup_test_db();
        let workspace_id = create_workspace(&db);

        let result = SceneAppService::plan_launch(
            &db,
            SceneAppLaunchIntent {
                sceneapp_id: "story-video-suite".to_string(),
                entry_source: Some("sceneapp_detail_preview".to_string()),
                workspace_id: Some(workspace_id.clone()),
                project_id: Some(workspace_id.clone()),
                user_input: Some("根据发布会亮点生成 30 秒短视频草稿".to_string()),
                reference_memory_ids: Vec::new(),
                slots: Default::default(),
                runtime_context: Some(SceneAppRuntimeContext {
                    cloud_session_ready: true,
                    ..Default::default()
                }),
            },
        )
        .expect("planning 失败");

        assert!(result.context_overlay.is_some());
        let loaded = load_persisted_sceneapp_context(
            &db,
            "story-video-suite",
            Some(workspace_id.as_str()),
            Some(workspace_id.as_str()),
        )
        .expect("读取 context 失败");
        assert!(loaded.is_none());
    }

    #[test]
    fn should_save_context_baseline_explicitly() {
        let db = setup_test_db();
        let workspace_id = create_workspace(&db);

        let result = SceneAppService::save_context_baseline(
            &db,
            SceneAppLaunchIntent {
                sceneapp_id: "story-video-suite".to_string(),
                entry_source: Some("sceneapp_detail_save_context_baseline".to_string()),
                workspace_id: Some(workspace_id.clone()),
                project_id: Some(workspace_id.clone()),
                user_input: Some("根据发布会亮点生成 30 秒短视频草稿".to_string()),
                reference_memory_ids: Vec::new(),
                slots: Default::default(),
                runtime_context: Some(SceneAppRuntimeContext {
                    cloud_session_ready: true,
                    ..Default::default()
                }),
            },
        )
        .expect("写入场景基线失败");

        let note_list = &result
            .context_overlay
            .as_ref()
            .expect("应返回 context overlay")
            .compiler_plan
            .notes;
        assert!(note_list
            .iter()
            .any(|note| note.contains("已写入项目级 Context Snapshot")));

        let loaded = load_persisted_sceneapp_context(
            &db,
            "story-video-suite",
            Some(workspace_id.as_str()),
            Some(workspace_id.as_str()),
        )
        .expect("读取 context 失败")
        .expect("应读取到已写入的 context");

        assert_eq!(loaded.reference_items.len(), 1);
        assert_eq!(loaded.reference_items[0].usage_count, Some(1));
        assert!(loaded.reference_items[0].last_used_at.is_some());
    }

    #[test]
    fn should_sync_run_feedback_into_persisted_context() {
        let db = setup_test_db();
        let workspace_id = create_workspace(&db);
        let persisted = create_persisted_context("story-video-suite", workspace_id.as_str());
        save_persisted_sceneapp_context(&db, &persisted)
            .expect("写入初始 context 失败")
            .expect("应返回 context 路径");

        let run = create_run_summary("story-video-suite", workspace_id.as_str());
        let scorecard = create_scorecard("story-video-suite");

        sync_persisted_context_feedback(&db, &run, Some(&scorecard))
            .expect("同步反馈失败")
            .expect("应返回回写后的 context");

        let loaded = load_persisted_sceneapp_context(
            &db,
            "story-video-suite",
            Some(workspace_id.as_str()),
            Some(workspace_id.as_str()),
        )
        .expect("读取回写后的 context 失败")
        .expect("应能读取到已回写 context");

        assert_eq!(
            loaded.last_feedback_run_id.as_deref(),
            Some(run.run_id.as_str())
        );
        assert_eq!(loaded.reference_items[0].usage_count, Some(1));
        assert_eq!(
            loaded.reference_items[0].last_feedback_label.as_deref(),
            Some("复核阻塞")
        );
        assert_eq!(
            loaded.reference_items[0].last_used_at.as_deref(),
            run.finished_at.as_deref()
        );
        assert!(loaded.taste_profile.as_ref().is_some_and(|profile| profile
            .feedback_summary
            .as_deref()
            .is_some_and(|summary| summary.contains("经营上建议优先优化"))
            && profile
                .feedback_signals
                .iter()
                .any(|signal| signal == "review_blocked")
            && profile
                .feedback_signals
                .iter()
                .any(|signal| signal == "artifact_validation_issue")));
    }

    #[test]
    fn should_not_double_count_same_run_feedback_when_scorecard_arrives_later() {
        let db = setup_test_db();
        let workspace_id = create_workspace(&db);
        let persisted = create_persisted_context("story-video-suite", workspace_id.as_str());
        save_persisted_sceneapp_context(&db, &persisted)
            .expect("写入初始 context 失败")
            .expect("应返回 context 路径");

        let run = create_run_summary("story-video-suite", workspace_id.as_str());
        sync_persisted_context_feedback(&db, &run, None)
            .expect("首次同步反馈失败")
            .expect("应返回首次回写后的 context");
        sync_persisted_context_feedback(&db, &run, Some(&create_scorecard("story-video-suite")))
            .expect("二次同步反馈失败")
            .expect("应返回二次回写后的 context");

        let loaded = load_persisted_sceneapp_context(
            &db,
            "story-video-suite",
            Some(workspace_id.as_str()),
            Some(workspace_id.as_str()),
        )
        .expect("读取回写后的 context 失败")
        .expect("应能读取到已回写 context");

        assert_eq!(loaded.reference_items[0].usage_count, Some(1));
        assert!(loaded.taste_profile.as_ref().is_some_and(|profile| profile
            .feedback_summary
            .as_deref()
            .is_some_and(|summary| summary.contains("经营上建议优先优化"))));
    }

    #[test]
    fn should_apply_manual_review_decision_into_existing_context() {
        let db = setup_test_db();
        let workspace_id = create_workspace(&db);
        let persisted = create_persisted_context("story-video-suite", workspace_id.as_str());
        save_persisted_sceneapp_context(&db, &persisted)
            .expect("写入初始 context 失败")
            .expect("应返回 context 路径");

        let run = create_run_summary("story-video-suite", workspace_id.as_str());
        sync_persisted_context_feedback(&db, &run, Some(&create_scorecard("story-video-suite")))
            .expect("先同步自动反馈失败")
            .expect("应返回自动反馈后的 context");

        let decision = RuntimeReviewDecisionContent {
            decision_status: "accepted".to_string(),
            decision_summary: "这轮结果已经可以进入发布前微调".to_string(),
            chosen_fix_strategy: "只补封面和字幕排版".to_string(),
            risk_level: "high".to_string(),
            risk_tags: Vec::new(),
            human_reviewer: "Robin".to_string(),
            reviewed_at: Some("2026-04-17T08:06:00.000Z".to_string()),
            followup_actions: vec!["补一版封面".to_string(), "复查字幕".to_string()],
            regression_requirements: vec!["确认视频导出尺寸".to_string()],
            notes: "先不要扩大发布范围".to_string(),
        };

        sync_persisted_context_review_decision(&db, &run, &decision)
            .expect("同步人工复核失败")
            .expect("应返回人工复核后的 context");

        let loaded = load_persisted_sceneapp_context(
            &db,
            "story-video-suite",
            Some(workspace_id.as_str()),
            Some(workspace_id.as_str()),
        )
        .expect("读取回写后的 context 失败")
        .expect("应能读取到人工复核后的 context");

        assert_eq!(loaded.reference_items[0].usage_count, Some(1));
        assert_eq!(
            loaded.reference_items[0].last_feedback_label.as_deref(),
            Some("人工接受 · 高风险")
        );
        assert_eq!(
            loaded.reference_items[0].last_used_at.as_deref(),
            Some("2026-04-17T08:06:00.000Z")
        );
        assert!(loaded.taste_profile.as_ref().is_some_and(|profile| profile
            .feedback_summary
            .as_deref()
            .is_some_and(|summary| summary.contains("人工复核结论：人工接受 · 高风险。"))
            && profile
                .feedback_summary
                .as_deref()
                .is_some_and(|summary| summary.contains("处理策略：只补封面和字幕排版。"))
            && profile
                .feedback_signals
                .iter()
                .any(|signal| signal == "review_decision_accepted")
            && profile
                .feedback_signals
                .iter()
                .any(|signal| signal == "review_risk_high")));
    }
}
