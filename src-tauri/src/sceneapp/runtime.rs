use super::adapters::build_sceneapp_runtime_adapter_plan;
use super::dto::*;

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

pub fn build_launch_plan(
    descriptor: SceneAppDescriptor,
    intent: SceneAppLaunchIntent,
) -> SceneAppPlanResult {
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
    use crate::sceneapp::dto::{
        SceneAppLaunchIntent, SceneAppRuntimeAction, SceneAppRuntimeContext,
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
                slots: BTreeMap::new(),
                runtime_context: Some(SceneAppRuntimeContext {
                    cloud_session_ready: true,
                    ..SceneAppRuntimeContext::default()
                }),
            },
        );

        assert_eq!(
            plan.plan.adapter_plan.runtime_action,
            SceneAppRuntimeAction::LaunchCloudScene
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
                slots,
                runtime_context: Some(SceneAppRuntimeContext {
                    browser_session_attached: true,
                    ..SceneAppRuntimeContext::default()
                }),
            },
        );

        assert_eq!(
            plan.plan.adapter_plan.runtime_action,
            SceneAppRuntimeAction::LaunchBrowserAssist
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
                slots: BTreeMap::new(),
                runtime_context: Some(SceneAppRuntimeContext {
                    automation_enabled: true,
                    ..SceneAppRuntimeContext::default()
                }),
            },
        );

        assert_eq!(
            plan.plan.adapter_plan.runtime_action,
            SceneAppRuntimeAction::CreateAutomationJob
        );
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
}
