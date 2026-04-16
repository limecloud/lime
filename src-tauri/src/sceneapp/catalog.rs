use super::dto::*;

const SEEDED_SCENEAPP_CATALOG_VERSION: &str = "2026-04-15";
const SEEDED_SCENEAPP_GENERATED_AT: &str = "2026-04-15T00:00:00.000Z";
const SEEDED_SCENEAPP_PACKAGE_ID: &str = "lime-core-sceneapps";

fn service_skill_binding(
    binding_family: SceneAppBindingFamily,
    service_skill_id: &str,
    skill_key: &str,
    aliases: &[&str],
) -> SceneAppEntryBinding {
    SceneAppEntryBinding {
        kind: SceneAppEntryBindingKind::ServiceSkill,
        binding_family,
        service_skill_id: Some(service_skill_id.to_string()),
        skill_key: Some(skill_key.to_string()),
        scene_key: None,
        command_prefix: None,
        aliases: aliases.iter().map(|alias| alias.to_string()).collect(),
    }
}

fn scene_binding(
    binding_family: SceneAppBindingFamily,
    scene_key: &str,
    command_prefix: &str,
    aliases: &[&str],
) -> SceneAppEntryBinding {
    SceneAppEntryBinding {
        kind: SceneAppEntryBindingKind::Scene,
        binding_family,
        service_skill_id: None,
        skill_key: None,
        scene_key: Some(scene_key.to_string()),
        command_prefix: Some(command_prefix.to_string()),
        aliases: aliases.iter().map(|alias| alias.to_string()).collect(),
    }
}

fn requirement(kind: SceneAppLaunchRequirementKind, message: &str) -> SceneAppLaunchRequirement {
    SceneAppLaunchRequirement {
        kind,
        message: message.to_string(),
    }
}

fn delivery_profile(
    artifact_profile_ref: &str,
    viewer_kind: &str,
    required_parts: &[&str],
    primary_part: &str,
) -> SceneAppDeliveryProfile {
    SceneAppDeliveryProfile {
        artifact_profile_ref: Some(artifact_profile_ref.to_string()),
        viewer_kind: Some(viewer_kind.to_string()),
        required_parts: required_parts.iter().map(|part| part.to_string()).collect(),
        primary_part: Some(primary_part.to_string()),
    }
}

fn composition_step(
    id: &str,
    order: usize,
    binding_profile_ref: &str,
    binding_family: SceneAppBindingFamily,
) -> SceneAppCompositionStepDescriptor {
    SceneAppCompositionStepDescriptor {
        id: id.to_string(),
        order,
        binding_profile_ref: Some(binding_profile_ref.to_string()),
        binding_family: Some(binding_family),
    }
}

fn composition_profile(
    blueprint_ref: &str,
    steps: Vec<SceneAppCompositionStepDescriptor>,
) -> SceneAppCompositionProfile {
    SceneAppCompositionProfile {
        blueprint_ref: Some(blueprint_ref.to_string()),
        step_count: steps.len(),
        steps,
    }
}

fn scorecard_profile(
    profile_ref: &str,
    metric_keys: &[&str],
    failure_signals: &[&str],
) -> SceneAppScorecardProfile {
    SceneAppScorecardProfile {
        profile_ref: Some(profile_ref.to_string()),
        metric_keys: metric_keys
            .iter()
            .map(|metric| metric.to_string())
            .collect(),
        failure_signals: failure_signals
            .iter()
            .map(|signal| signal.to_string())
            .collect(),
    }
}

fn seeded_story_video_suite() -> SceneAppDescriptor {
    SceneAppDescriptor {
        id: "story-video-suite".to_string(),
        title: "短视频编排".to_string(),
        summary: "把文本、线框图、配乐、剧本和短视频草稿收口成一条多模态结果链。".to_string(),
        category: "Scene Apps".to_string(),
        sceneapp_type: SceneAppType::Hybrid,
        pattern_primary: SceneAppPattern::Pipeline,
        pattern_stack: vec![
            SceneAppPattern::Pipeline,
            SceneAppPattern::Inversion,
            SceneAppPattern::Generator,
            SceneAppPattern::Reviewer,
        ],
        capability_refs: vec![
            "cloud_scene".to_string(),
            "native_skill".to_string(),
            "workspace_storage".to_string(),
            "artifact_viewer".to_string(),
        ],
        infra_profile: vec![
            "composition_blueprint".to_string(),
            "project_pack".to_string(),
            "workspace_storage".to_string(),
            "cloud_runtime".to_string(),
            "timeline".to_string(),
        ],
        delivery_contract: SceneAppDeliveryContract::ProjectPack,
        artifact_kind: Some("artifact_bundle".to_string()),
        output_hint: "短视频项目包".to_string(),
        entry_bindings: vec![
            service_skill_binding(
                SceneAppBindingFamily::CloudScene,
                "sceneapp-service-story-video",
                "story-video-suite",
                &["story-video", "mv-pipeline"],
            ),
            scene_binding(
                SceneAppBindingFamily::CloudScene,
                "story-video-suite",
                "/story-video-suite",
                &["story-video-scene"],
            ),
        ],
        launch_requirements: vec![
            requirement(
                SceneAppLaunchRequirementKind::UserInput,
                "需要主题、风格或脚本线索作为场景输入。",
            ),
            requirement(
                SceneAppLaunchRequirementKind::Project,
                "需要项目目录承接线框图、脚本和媒体结果。",
            ),
            requirement(
                SceneAppLaunchRequirementKind::CloudSession,
                "需要可用的云端运行时来完成多模态媒体处理。",
            ),
        ],
        linked_service_skill_id: Some("sceneapp-service-story-video".to_string()),
        linked_scene_key: Some("story-video-suite".to_string()),
        delivery_profile: Some(delivery_profile(
            "story-video-artifacts",
            "artifact_bundle",
            &[
                "brief",
                "storyboard",
                "script",
                "music_refs",
                "video_draft",
                "review_note",
            ],
            "brief",
        )),
        composition_profile: Some(composition_profile(
            "story-video-blueprint",
            vec![
                composition_step(
                    "brief",
                    1,
                    "story-video-native-binding",
                    SceneAppBindingFamily::NativeSkill,
                ),
                composition_step(
                    "storyboard",
                    2,
                    "story-video-native-binding",
                    SceneAppBindingFamily::NativeSkill,
                ),
                composition_step(
                    "script",
                    3,
                    "story-video-native-binding",
                    SceneAppBindingFamily::NativeSkill,
                ),
                composition_step(
                    "music_refs",
                    4,
                    "story-video-cloud-binding",
                    SceneAppBindingFamily::CloudScene,
                ),
                composition_step(
                    "video_draft",
                    5,
                    "story-video-cloud-binding",
                    SceneAppBindingFamily::CloudScene,
                ),
                composition_step(
                    "review_note",
                    6,
                    "story-video-native-binding",
                    SceneAppBindingFamily::NativeSkill,
                ),
            ],
        )),
        scorecard_profile: Some(scorecard_profile(
            "story-video-scorecard",
            &[
                "complete_pack_rate",
                "review_pass_rate",
                "publish_conversion_rate",
            ],
            &["pack_incomplete", "review_blocked", "publish_stalled"],
        )),
        aliases: vec![
            "story-video".to_string(),
            "mv-pipeline".to_string(),
            "short-video-suite".to_string(),
        ],
        source_package_id: SEEDED_SCENEAPP_PACKAGE_ID.to_string(),
        source_package_version: SEEDED_SCENEAPP_CATALOG_VERSION.to_string(),
    }
}

fn seeded_article_export() -> SceneAppDescriptor {
    SceneAppDescriptor {
        id: "x-article-export".to_string(),
        title: "网页导出".to_string(),
        summary: "在真实浏览器上下文中抓取网页正文、图片与元信息，并沉淀为项目内 Markdown 资料包。"
            .to_string(),
        category: "Scene Apps".to_string(),
        sceneapp_type: SceneAppType::BrowserGrounded,
        pattern_primary: SceneAppPattern::Pipeline,
        pattern_stack: vec![
            SceneAppPattern::Pipeline,
            SceneAppPattern::ToolWrapper,
            SceneAppPattern::Generator,
            SceneAppPattern::Inversion,
        ],
        capability_refs: vec![
            "browser_assist".to_string(),
            "workspace_storage".to_string(),
            "artifact_viewer".to_string(),
        ],
        infra_profile: vec![
            "browser_connector".to_string(),
            "site_adapter".to_string(),
            "workspace_storage".to_string(),
            "artifact_bundle".to_string(),
        ],
        delivery_contract: SceneAppDeliveryContract::ProjectPack,
        artifact_kind: Some("document".to_string()),
        output_hint: "网页资料包".to_string(),
        entry_bindings: vec![
            service_skill_binding(
                SceneAppBindingFamily::BrowserAssist,
                "sceneapp-service-article-export",
                "x-article-export",
                &["article-export"],
            ),
            scene_binding(
                SceneAppBindingFamily::BrowserAssist,
                "x-article-export",
                "/x-article-export",
                &["web-article-export"],
            ),
        ],
        launch_requirements: vec![
            requirement(
                SceneAppLaunchRequirementKind::BrowserSession,
                "需要真实网页上下文或浏览器附着会话。",
            ),
            requirement(
                SceneAppLaunchRequirementKind::Project,
                "需要项目目录来保存 Markdown 与图片资源。",
            ),
        ],
        linked_service_skill_id: Some("sceneapp-service-article-export".to_string()),
        linked_scene_key: Some("x-article-export".to_string()),
        delivery_profile: Some(delivery_profile(
            "article-export-artifacts",
            "document",
            &["index.md", "meta.json"],
            "index.md",
        )),
        composition_profile: None,
        scorecard_profile: Some(scorecard_profile(
            "article-export-scorecard",
            &["success_rate", "reuse_rate"],
            &["pack_incomplete"],
        )),
        aliases: vec![
            "article-export".to_string(),
            "web-article-export".to_string(),
        ],
        source_package_id: SEEDED_SCENEAPP_PACKAGE_ID.to_string(),
        source_package_version: SEEDED_SCENEAPP_CATALOG_VERSION.to_string(),
    }
}

fn seeded_voice_runtime() -> SceneAppDescriptor {
    SceneAppDescriptor {
        id: "voice-runtime".to_string(),
        title: "配音生成".to_string(),
        summary: "把文稿或视频内容交给托管能力完成配音，并回流成可试听的媒体产物。".to_string(),
        category: "Scene Apps".to_string(),
        sceneapp_type: SceneAppType::CloudManaged,
        pattern_primary: SceneAppPattern::Pipeline,
        pattern_stack: vec![SceneAppPattern::Pipeline, SceneAppPattern::Generator],
        capability_refs: vec![
            "cloud_scene".to_string(),
            "workspace_storage".to_string(),
            "artifact_viewer".to_string(),
        ],
        infra_profile: vec![
            "cloud_runtime".to_string(),
            "media_artifact".to_string(),
            "json_snapshot".to_string(),
        ],
        delivery_contract: SceneAppDeliveryContract::ArtifactBundle,
        artifact_kind: Some("report".to_string()),
        output_hint: "媒体结果".to_string(),
        entry_bindings: vec![service_skill_binding(
            SceneAppBindingFamily::CloudScene,
            "sceneapp-service-voice-runtime",
            "voice-runtime",
            &["voiceover", "tts-scene"],
        )],
        launch_requirements: vec![
            requirement(
                SceneAppLaunchRequirementKind::UserInput,
                "需要文稿正文或待配音素材说明。",
            ),
            requirement(
                SceneAppLaunchRequirementKind::CloudSession,
                "需要云端媒体运行时或 OEM 托管会话。",
            ),
        ],
        linked_service_skill_id: Some("sceneapp-service-voice-runtime".to_string()),
        linked_scene_key: Some("voice-runtime".to_string()),
        delivery_profile: Some(delivery_profile(
            "voice-runtime-artifacts",
            "artifact_bundle",
            &["audio.mp3", "review_note"],
            "audio.mp3",
        )),
        composition_profile: None,
        scorecard_profile: Some(scorecard_profile(
            "voice-runtime-scorecard",
            &["success_rate", "reuse_rate"],
            &["pack_incomplete"],
        )),
        aliases: vec!["voiceover".to_string(), "tts-scene".to_string()],
        source_package_id: SEEDED_SCENEAPP_PACKAGE_ID.to_string(),
        source_package_version: SEEDED_SCENEAPP_CATALOG_VERSION.to_string(),
    }
}

fn seeded_daily_trend_briefing() -> SceneAppDescriptor {
    SceneAppDescriptor {
        id: "daily-trend-briefing".to_string(),
        title: "每日趋势摘要".to_string(),
        summary: "把研究主题转成可持续运行的本地 durable 场景，并定时回流结果和失败原因。"
            .to_string(),
        category: "Scene Apps".to_string(),
        sceneapp_type: SceneAppType::LocalDurable,
        pattern_primary: SceneAppPattern::Pipeline,
        pattern_stack: vec![SceneAppPattern::Pipeline, SceneAppPattern::Reviewer],
        capability_refs: vec![
            "automation_job".to_string(),
            "workspace_storage".to_string(),
            "timeline".to_string(),
        ],
        infra_profile: vec![
            "automation_schedule".to_string(),
            "db_store".to_string(),
            "json_snapshot".to_string(),
        ],
        delivery_contract: SceneAppDeliveryContract::TableReport,
        artifact_kind: Some("table_report".to_string()),
        output_hint: "趋势摘要".to_string(),
        entry_bindings: vec![service_skill_binding(
            SceneAppBindingFamily::AutomationJob,
            "sceneapp-service-daily-trend",
            "daily-trend-briefing",
            &["trend-briefing", "growth-monitor"],
        )],
        launch_requirements: vec![
            requirement(
                SceneAppLaunchRequirementKind::Project,
                "需要工作区或项目目录保存运行历史与结果快照。",
            ),
            requirement(
                SceneAppLaunchRequirementKind::Automation,
                "需要可用的自动化调度能力。",
            ),
        ],
        linked_service_skill_id: Some("sceneapp-service-daily-trend".to_string()),
        linked_scene_key: Some("daily-trend-briefing".to_string()),
        delivery_profile: Some(delivery_profile(
            "daily-trend-artifacts",
            "table_report",
            &["brief", "review_note"],
            "brief",
        )),
        composition_profile: None,
        scorecard_profile: Some(scorecard_profile(
            "daily-trend-scorecard",
            &["success_rate", "reuse_rate"],
            &["automation_timeout"],
        )),
        aliases: vec!["trend-briefing".to_string(), "growth-monitor".to_string()],
        source_package_id: SEEDED_SCENEAPP_PACKAGE_ID.to_string(),
        source_package_version: SEEDED_SCENEAPP_CATALOG_VERSION.to_string(),
    }
}

pub fn seeded_sceneapp_descriptors() -> Vec<SceneAppDescriptor> {
    vec![
        seeded_story_video_suite(),
        seeded_article_export(),
        seeded_voice_runtime(),
        seeded_daily_trend_briefing(),
    ]
}

pub fn seeded_sceneapp_catalog() -> SceneAppCatalog {
    SceneAppCatalog {
        version: SEEDED_SCENEAPP_CATALOG_VERSION.to_string(),
        generated_at: SEEDED_SCENEAPP_GENERATED_AT.to_string(),
        items: seeded_sceneapp_descriptors(),
    }
}

pub fn get_sceneapp_descriptor(id: &str) -> Option<SceneAppDescriptor> {
    let normalized = id.trim();
    if normalized.is_empty() {
        return None;
    }

    seeded_sceneapp_descriptors()
        .into_iter()
        .find(|descriptor| {
            descriptor.id == normalized
                || descriptor
                    .aliases
                    .iter()
                    .any(|alias| alias.eq_ignore_ascii_case(normalized))
                || descriptor
                    .linked_scene_key
                    .as_deref()
                    .is_some_and(|scene_key| scene_key == normalized)
                || descriptor
                    .linked_service_skill_id
                    .as_deref()
                    .is_some_and(|service_skill_id| service_skill_id == normalized)
        })
}
