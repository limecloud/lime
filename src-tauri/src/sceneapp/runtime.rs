use super::adapters::build_sceneapp_runtime_adapter_plan;
use super::context::compiler::build_sceneapp_context_overlay;
use super::context::dto::{ReferenceItem, SceneAppContextOverlay};
use super::context::store::PersistedSceneAppContext;
use super::dto::*;
use std::collections::BTreeSet;

fn pattern_title(pattern: &SceneAppPattern) -> &'static str {
    match pattern {
        SceneAppPattern::Pipeline => "执行多步场景编排",
        SceneAppPattern::Generator => "生成结构化结果产物",
        SceneAppPattern::Reviewer => "执行末尾质量审查",
        SceneAppPattern::Inversion => "补齐缺失参数与上下文",
        SceneAppPattern::ToolWrapper => "加载站点/协议封装能力",
    }
}

fn storage_strategy(descriptor: &SceneAppDescriptor) -> String {
    if descriptor
        .infra_profile
        .iter()
        .any(|item| item == "db_store" || item == "json_snapshot")
    {
        return "db_plus_snapshot".to_string();
    }
    if descriptor
        .infra_profile
        .iter()
        .any(|item| item == "artifact_bundle" || item == "workspace_storage")
    {
        return "workspace_bundle".to_string();
    }
    "session_only".to_string()
}

fn governance_hooks(descriptor: &SceneAppDescriptor) -> Vec<String> {
    let mut hooks = vec!["evidence_pack".to_string(), "scorecard".to_string()];
    if descriptor
        .pattern_stack
        .iter()
        .any(|pattern| matches!(pattern, SceneAppPattern::Reviewer))
    {
        hooks.push("review_policy".to_string());
    }
    if descriptor
        .infra_profile
        .iter()
        .any(|item| item == "automation_schedule")
    {
        hooks.push("retry_policy".to_string());
    }
    hooks
}

fn requirement_satisfied(
    requirement: &SceneAppLaunchRequirement,
    intent: &SceneAppLaunchIntent,
) -> bool {
    let runtime = intent.runtime_context.clone().unwrap_or_default();
    match requirement.kind {
        SceneAppLaunchRequirementKind::UserInput => {
            intent
                .user_input
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                || intent.slots.values().any(|value| !value.trim().is_empty())
        }
        SceneAppLaunchRequirementKind::Project => intent
            .project_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()),
        SceneAppLaunchRequirementKind::BrowserSession => runtime.browser_session_attached,
        SceneAppLaunchRequirementKind::CloudSession => runtime.cloud_session_ready,
        SceneAppLaunchRequirementKind::Automation => runtime.automation_enabled,
    }
}

fn build_readiness(
    descriptor: &SceneAppDescriptor,
    intent: &SceneAppLaunchIntent,
) -> SceneAppReadiness {
    let unmet_requirements = descriptor
        .launch_requirements
        .iter()
        .filter(|requirement| !requirement_satisfied(requirement, intent))
        .cloned()
        .collect::<Vec<_>>();

    SceneAppReadiness {
        ready: unmet_requirements.is_empty(),
        unmet_requirements,
    }
}

fn build_step_plan(descriptor: &SceneAppDescriptor) -> Vec<SceneAppExecutionPlanStep> {
    let binding_family = descriptor
        .entry_bindings
        .first()
        .map(|binding| binding.binding_family.clone())
        .unwrap_or(SceneAppBindingFamily::AgentTurn);

    descriptor
        .pattern_stack
        .iter()
        .enumerate()
        .map(|(index, pattern)| SceneAppExecutionPlanStep {
            id: format!("step-{}", index + 1),
            title: pattern_title(pattern).to_string(),
            binding_family: binding_family.clone(),
        })
        .collect()
}

fn dedupe_strings<I>(values: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    let mut seen = BTreeSet::new();
    values
        .into_iter()
        .filter_map(|value| {
            let normalized = value.trim().to_string();
            if normalized.is_empty() || !seen.insert(normalized.clone()) {
                return None;
            }
            Some(normalized)
        })
        .collect()
}

fn build_project_pack_required_parts(descriptor: &SceneAppDescriptor) -> Vec<String> {
    let declared_parts = descriptor
        .delivery_profile
        .as_ref()
        .map(|profile| profile.required_parts.clone())
        .unwrap_or_default();
    if !declared_parts.is_empty() {
        return dedupe_strings(declared_parts);
    }

    descriptor
        .composition_profile
        .as_ref()
        .map(|profile| {
            dedupe_strings(
                profile
                    .steps
                    .iter()
                    .map(|step| step.id.clone())
                    .collect::<Vec<_>>(),
            )
        })
        .unwrap_or_default()
}

fn build_project_pack_completion_strategy(
    descriptor: &SceneAppDescriptor,
    required_parts: &[String],
) -> String {
    if !required_parts.is_empty() {
        return "required_parts_complete".to_string();
    }
    if descriptor
        .infra_profile
        .iter()
        .any(|item| item == "workspace_storage" || item == "artifact_bundle")
    {
        return "workspace_artifact_writeback".to_string();
    }
    "artifact_writeback".to_string()
}

fn build_project_pack_plan(
    descriptor: &SceneAppDescriptor,
    intent: &SceneAppLaunchIntent,
    context_overlay: &SceneAppContextOverlay,
) -> SceneAppProjectPackPlan {
    let required_parts = build_project_pack_required_parts(descriptor);
    let viewer_kind = descriptor
        .delivery_profile
        .as_ref()
        .and_then(|profile| profile.viewer_kind.clone());
    let primary_part = descriptor
        .delivery_profile
        .as_ref()
        .and_then(|profile| profile.primary_part.clone())
        .or_else(|| required_parts.first().cloned());
    let completion_strategy =
        build_project_pack_completion_strategy(descriptor, required_parts.as_slice());
    let mut notes = Vec::new();

    if matches!(
        descriptor.delivery_contract,
        SceneAppDeliveryContract::ProjectPack
    ) {
        notes.push("当前 SceneApp 以结果包作为默认交付单位。".to_string());
    }
    if !required_parts.is_empty() {
        notes.push(format!(
            "完整度将按 {} 个必含部件判断。",
            required_parts.len()
        ));
    }
    if let Some(project_id) = intent
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        notes.push(format!(
            "结果会优先回写到项目 {project_id}，便于继续编辑与复盘。"
        ));
    } else {
        notes.push("当前还没有绑定项目，结果包只能先按运行时结果临时回流。".to_string());
    }
    if context_overlay.compiler_plan.reference_count > 0
        || context_overlay.snapshot.taste_profile.is_some()
    {
        notes.push("结果包会连同参考与风格快照一起进入后续治理链。".to_string());
    }
    if viewer_kind.is_some() {
        notes.push("结果包可继续复用当前 viewer 主链打开与检查。".to_string());
    }

    SceneAppProjectPackPlan {
        pack_kind: descriptor.delivery_contract.clone(),
        primary_part,
        required_parts,
        viewer_kind,
        completion_strategy,
        notes,
    }
}

pub fn build_launch_plan(
    descriptor: SceneAppDescriptor,
    intent: SceneAppLaunchIntent,
    persisted_context: Option<&PersistedSceneAppContext>,
    explicit_reference_items: &[ReferenceItem],
) -> SceneAppPlanResult {
    let context_overlay = build_sceneapp_context_overlay(
        &descriptor,
        &intent,
        persisted_context,
        explicit_reference_items,
    );
    let project_pack_plan = build_project_pack_plan(&descriptor, &intent, &context_overlay);
    let sceneapp_id = descriptor.id.clone();
    let binding_family = descriptor
        .entry_bindings
        .first()
        .map(|binding| binding.binding_family.clone())
        .unwrap_or(SceneAppBindingFamily::AgentTurn);
    let readiness = build_readiness(&descriptor, &intent);
    let step_plan = build_step_plan(&descriptor);
    let adapter_plan = build_sceneapp_runtime_adapter_plan(&descriptor, &intent);
    let storage_strategy = storage_strategy(&descriptor);
    let artifact_contract = descriptor.delivery_contract.clone();
    let hooks = governance_hooks(&descriptor);
    let mut warnings = Vec::new();
    if !readiness.ready {
        warnings.push("当前 SceneApp 仍有未满足的启动前置条件。".to_string());
    }
    if !intent
        .workspace_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        warnings.push("尚未显式绑定 workspace_id，后续应接入统一工作区边界。".to_string());
    }

    SceneAppPlanResult {
        descriptor: descriptor.clone(),
        readiness,
        context_overlay: Some(context_overlay),
        project_pack_plan: Some(project_pack_plan),
        plan: SceneAppExecutionPlan {
            sceneapp_id,
            executor_kind: binding_family.clone(),
            binding_family,
            step_plan,
            adapter_plan,
            storage_strategy,
            artifact_contract,
            governance_hooks: hooks,
            warnings,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::build_launch_plan;
    use crate::sceneapp::catalog::get_sceneapp_descriptor;
    use crate::sceneapp::context::dto::{ContextLayerSourceKind, ReferenceItem, TasteProfile};
    use crate::sceneapp::context::store::PersistedSceneAppContext;
    use crate::sceneapp::dto::{
        SceneAppDeliveryContract, SceneAppLaunchIntent, SceneAppRuntimeAction,
        SceneAppRuntimeContext,
    };
    use std::collections::BTreeMap;

    #[test]
    fn should_build_cloud_scene_adapter_plan_for_hybrid_sceneapp() {
        let descriptor = get_sceneapp_descriptor("story-video-suite")
            .expect("story-video-suite descriptor should exist");
        let plan = build_launch_plan(
            descriptor,
            SceneAppLaunchIntent {
                sceneapp_id: "story-video-suite".to_string(),
                entry_source: Some("sceneapp_card".to_string()),
                workspace_id: Some("workspace-default".to_string()),
                project_id: Some("project-video".to_string()),
                user_input: Some("根据发布会内容生成 30 秒短视频草稿".to_string()),
                reference_memory_ids: Vec::new(),
                slots: BTreeMap::new(),
                runtime_context: Some(SceneAppRuntimeContext {
                    cloud_session_ready: true,
                    ..SceneAppRuntimeContext::default()
                }),
            },
            None,
            &[],
        );

        assert_eq!(
            plan.plan.adapter_plan.runtime_action,
            SceneAppRuntimeAction::LaunchCloudScene
        );
        assert!(plan.context_overlay.is_some());
        assert_eq!(
            plan.context_overlay
                .as_ref()
                .map(|overlay| overlay.compiler_plan.reference_count),
            Some(1)
        );
        assert_eq!(
            plan.project_pack_plan
                .as_ref()
                .map(|pack| pack.pack_kind.clone()),
            Some(SceneAppDeliveryContract::ProjectPack)
        );
        assert_eq!(
            plan.project_pack_plan
                .as_ref()
                .map(|pack| pack.completion_strategy.as_str()),
            Some("required_parts_complete")
        );
        assert_eq!(
            plan.plan.adapter_plan.target_ref,
            "sceneapp-service-story-video"
        );
        assert!(plan
            .plan
            .adapter_plan
            .request_metadata
            .pointer("/harness/service_scene_launch/service_scene_run/scene_key")
            .is_some());
    }

    #[test]
    fn should_build_browser_assist_adapter_plan_with_known_adapter_name() {
        let descriptor = get_sceneapp_descriptor("x-article-export")
            .expect("x-article-export descriptor should exist");
        let mut slots = BTreeMap::new();
        slots.insert(
            "article_url".to_string(),
            "https://x.com/openai/article/123".to_string(),
        );
        slots.insert("target_language".to_string(), "中文".to_string());

        let plan = build_launch_plan(
            descriptor,
            SceneAppLaunchIntent {
                sceneapp_id: "x-article-export".to_string(),
                entry_source: Some("sceneapp_card".to_string()),
                workspace_id: Some("workspace-default".to_string()),
                project_id: Some("project-research".to_string()),
                user_input: Some("请导出这篇文章".to_string()),
                reference_memory_ids: Vec::new(),
                slots,
                runtime_context: Some(SceneAppRuntimeContext {
                    browser_session_attached: true,
                    ..SceneAppRuntimeContext::default()
                }),
            },
            None,
            &[],
        );

        assert_eq!(
            plan.plan.adapter_plan.runtime_action,
            SceneAppRuntimeAction::LaunchBrowserAssist
        );
        assert!(plan.context_overlay.as_ref().is_some_and(|overlay| overlay
            .compiler_plan
            .active_layers
            .contains(&"reference".to_string())));
        assert_eq!(
            plan.project_pack_plan
                .as_ref()
                .map(|pack| pack.required_parts.len()),
            Some(2)
        );
        assert_eq!(plan.plan.adapter_plan.target_ref, "x/article-export");
        assert_eq!(
            plan.plan.adapter_plan.preferred_profile_key.as_deref(),
            Some("general_browser_assist")
        );
        assert_eq!(
            plan.plan
                .adapter_plan
                .launch_payload
                .pointer("/args/url")
                .and_then(|value| value.as_str()),
            Some("https://x.com/openai/article/123")
        );
    }

    #[test]
    fn should_build_automation_adapter_plan_for_local_durable_sceneapp() {
        let descriptor = get_sceneapp_descriptor("daily-trend-briefing")
            .expect("daily-trend-briefing descriptor should exist");
        let plan = build_launch_plan(
            descriptor,
            SceneAppLaunchIntent {
                sceneapp_id: "daily-trend-briefing".to_string(),
                entry_source: Some("sceneapp_card".to_string()),
                workspace_id: Some("workspace-default".to_string()),
                project_id: Some("project-growth".to_string()),
                user_input: Some("关注 AI Agent 产品趋势".to_string()),
                reference_memory_ids: Vec::new(),
                slots: BTreeMap::new(),
                runtime_context: Some(SceneAppRuntimeContext {
                    automation_enabled: true,
                    ..SceneAppRuntimeContext::default()
                }),
            },
            None,
            &[],
        );

        assert_eq!(
            plan.plan.adapter_plan.runtime_action,
            SceneAppRuntimeAction::CreateAutomationJob
        );
        assert!(plan.context_overlay.as_ref().is_some_and(|overlay| overlay
            .compiler_plan
            .active_layers
            .contains(&"memory".to_string())));
        assert_eq!(
            plan.plan.adapter_plan.target_ref,
            "sceneapp-service-daily-trend"
        );
        assert_eq!(
            plan.plan
                .adapter_plan
                .launch_payload
                .pointer("/schedule/kind")
                .and_then(|value| value.as_str()),
            Some("every")
        );
    }

    #[test]
    fn should_merge_persisted_context_into_launch_plan() {
        let descriptor = get_sceneapp_descriptor("story-video-suite")
            .expect("story-video-suite descriptor should exist");
        let persisted_context = PersistedSceneAppContext {
            sceneapp_id: "story-video-suite".to_string(),
            workspace_id: Some("workspace-default".to_string()),
            project_id: Some("project-video".to_string()),
            reference_items: vec![ReferenceItem {
                id: "saved-reference-1".to_string(),
                label: "历史拆解".to_string(),
                source_kind: ContextLayerSourceKind::ReferenceLibrary,
                content_type: "text".to_string(),
                uri: None,
                summary: Some("保留强开头与多镜头切换。".to_string()),
                selected: true,
                usage_count: Some(1),
                last_used_at: Some("2026-04-16T00:00:00.000Z".to_string()),
                last_feedback_label: Some("可继续复用".to_string()),
            }],
            taste_profile: Some(TasteProfile {
                profile_id: "taste-story-video-suite".to_string(),
                summary: "偏好科技感、快节奏。".to_string(),
                keywords: vec!["科技感".to_string(), "快节奏".to_string()],
                avoid_keywords: vec!["铺垫过长".to_string()],
                derived_from_reference_ids: vec!["saved-reference-1".to_string()],
                confidence: Some(0.74),
                feedback_summary: Some("最近一次运行可继续复用。".to_string()),
                feedback_signals: vec!["publish_ready".to_string()],
                last_feedback_at: Some("2026-04-16T00:00:00.000Z".to_string()),
            }),
            last_feedback_run_id: Some("sceneapp-run-1".to_string()),
        };
        let mut slots = BTreeMap::new();
        slots.insert("style".to_string(), "科技感".to_string());

        let plan = build_launch_plan(
            descriptor,
            SceneAppLaunchIntent {
                sceneapp_id: "story-video-suite".to_string(),
                entry_source: Some("sceneapp_card".to_string()),
                workspace_id: Some("workspace-default".to_string()),
                project_id: Some("project-video".to_string()),
                user_input: Some("根据这次发布会做 30 秒短视频".to_string()),
                reference_memory_ids: Vec::new(),
                slots,
                runtime_context: Some(SceneAppRuntimeContext {
                    cloud_session_ready: true,
                    ..SceneAppRuntimeContext::default()
                }),
            },
            Some(&persisted_context),
            &[],
        );

        let overlay = plan.context_overlay.expect("context overlay should exist");
        assert_eq!(overlay.compiler_plan.reference_count, 3);
        assert!(overlay
            .compiler_plan
            .notes
            .iter()
            .any(|note| note.contains("已从项目上下文恢复 1 条历史参考")));
        assert!(overlay
            .compiler_plan
            .notes
            .iter()
            .any(|note| note.contains("当前已复用项目级 TasteProfile")));
    }
}
