use super::dto::*;
use crate::agent::AsterAgentWrapper;
use crate::commands::aster_agent_cmd::AgentRuntimeThreadReadModel;
use crate::database::dao::agent_run::{AgentRun, AgentRunStatus};
use crate::database::DbConnection;
use crate::services::automation_service::{
    AutomationCycleResult, AutomationJobDraft, AutomationJobRecord, AutomationPayload,
};
use crate::services::runtime_evidence_pack_service::{
    build_runtime_evidence_sceneapp_snapshot, export_runtime_evidence_pack,
    resolve_runtime_export_workspace_root, RuntimeEvidenceSceneAppSnapshot,
};
use crate::services::runtime_review_decision_service::export_runtime_review_decision_template;
use crate::services::thread_reliability_projection_service::sync_thread_reliability_projection;
use chrono::{DateTime, Utc};
use lime_core::config::{AutomationExecutionMode, DeliveryConfig, TaskSchedule};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

const GENERAL_BROWSER_ASSIST_PROFILE_KEY: &str = "general_browser_assist";
const SCENEAPP_RUNTIME_SESSION_RELATIVE_ROOT: &str = ".lime/harness/sessions";
const SCENEAPP_EVIDENCE_SUMMARY_RELATIVE_PATH: &str = "evidence/summary.md";
const SCENEAPP_REVIEW_DECISION_MARKDOWN_RELATIVE_PATH: &str = "review/review-decision.md";
const SCENEAPP_REVIEW_DECISION_JSON_RELATIVE_PATH: &str = "review/review-decision.json";

struct SceneAppRunExportContext {
    detail: crate::agent::SessionDetail,
    thread_read: AgentRuntimeThreadReadModel,
    workspace_root: PathBuf,
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn primary_binding_family(descriptor: &SceneAppDescriptor) -> SceneAppBindingFamily {
    descriptor
        .entry_bindings
        .first()
        .map(|binding| binding.binding_family.clone())
        .unwrap_or(SceneAppBindingFamily::AgentTurn)
}

fn default_sceneapp_schedule() -> TaskSchedule {
    TaskSchedule::Every { every_secs: 3600 }
}

fn default_sceneapp_delivery() -> DeliveryConfig {
    DeliveryConfig::default()
}

fn binding_family_to_string(binding: &SceneAppBindingFamily) -> &'static str {
    match binding {
        SceneAppBindingFamily::AgentTurn => "agent_turn",
        SceneAppBindingFamily::BrowserAssist => "browser_assist",
        SceneAppBindingFamily::AutomationJob => "automation_job",
        SceneAppBindingFamily::CloudScene => "cloud_scene",
        SceneAppBindingFamily::NativeSkill => "native_skill",
    }
}

fn pattern_to_string(pattern: &SceneAppPattern) -> &'static str {
    match pattern {
        SceneAppPattern::Pipeline => "pipeline",
        SceneAppPattern::Generator => "generator",
        SceneAppPattern::Reviewer => "reviewer",
        SceneAppPattern::Inversion => "inversion",
        SceneAppPattern::ToolWrapper => "tool_wrapper",
    }
}

fn sceneapp_type_to_string(sceneapp_type: &SceneAppType) -> &'static str {
    match sceneapp_type {
        SceneAppType::LocalInstant => "local_instant",
        SceneAppType::LocalDurable => "local_durable",
        SceneAppType::BrowserGrounded => "browser_grounded",
        SceneAppType::CloudManaged => "cloud_managed",
        SceneAppType::Hybrid => "hybrid",
    }
}

fn delivery_contract_to_string(delivery_contract: &SceneAppDeliveryContract) -> &'static str {
    match delivery_contract {
        SceneAppDeliveryContract::ArtifactBundle => "artifact_bundle",
        SceneAppDeliveryContract::ProjectPack => "project_pack",
        SceneAppDeliveryContract::TableReport => "table_report",
    }
}

fn build_sceneapp_metadata_sceneapp_value(descriptor: &SceneAppDescriptor) -> Value {
    json!({
        "id": descriptor.id.clone(),
        "title": descriptor.title.clone(),
        "sceneapp_type": sceneapp_type_to_string(&descriptor.sceneapp_type),
        "pattern_primary": pattern_to_string(&descriptor.pattern_primary),
        "pattern_stack": descriptor.pattern_stack.iter().map(pattern_to_string).collect::<Vec<_>>(),
        "infra_profile": descriptor.infra_profile.clone(),
        "delivery_contract": delivery_contract_to_string(&descriptor.delivery_contract),
        "source_package_id": descriptor.source_package_id.clone(),
        "source_package_version": descriptor.source_package_version.clone(),
    })
}

fn build_sceneapp_launch_harness_value(
    descriptor: &SceneAppDescriptor,
    launch_intent: &SceneAppLaunchIntent,
) -> Value {
    json!({
        "sceneapp_id": descriptor.id.clone(),
        "sceneapp_type": sceneapp_type_to_string(&descriptor.sceneapp_type),
        "pattern_primary": pattern_to_string(&descriptor.pattern_primary),
        "pattern_stack": descriptor.pattern_stack.iter().map(pattern_to_string).collect::<Vec<_>>(),
        "infra_profile": descriptor.infra_profile.clone(),
        "delivery_contract": delivery_contract_to_string(&descriptor.delivery_contract),
        "entry_source": launch_intent.entry_source.clone(),
        "workspace_id": launch_intent.workspace_id.clone(),
        "project_id": launch_intent.project_id.clone(),
        "linked_service_skill_id": descriptor.linked_service_skill_id.clone(),
        "linked_scene_key": descriptor.linked_scene_key.clone(),
    })
}

fn build_sceneapp_harness_map(
    descriptor: &SceneAppDescriptor,
    launch_intent: &SceneAppLaunchIntent,
) -> Map<String, Value> {
    let mut harness = Map::new();
    harness.insert("sceneapp_id".to_string(), json!(descriptor.id.clone()));
    harness.insert(
        "sceneapp_type".to_string(),
        json!(sceneapp_type_to_string(&descriptor.sceneapp_type)),
    );
    harness.insert(
        "pattern_primary".to_string(),
        json!(pattern_to_string(&descriptor.pattern_primary)),
    );
    harness.insert(
        "pattern_stack".to_string(),
        json!(descriptor
            .pattern_stack
            .iter()
            .map(pattern_to_string)
            .collect::<Vec<_>>()),
    );
    harness.insert(
        "infra_profile".to_string(),
        json!(descriptor.infra_profile.clone()),
    );
    harness.insert(
        "entry_source".to_string(),
        json!(launch_intent.entry_source.clone()),
    );
    harness.insert(
        "project_id".to_string(),
        json!(launch_intent.project_id.clone()),
    );
    harness.insert(
        "workspace_id".to_string(),
        json!(launch_intent.workspace_id.clone()),
    );
    harness.insert(
        "sceneapp_launch".to_string(),
        build_sceneapp_launch_harness_value(descriptor, launch_intent),
    );
    harness
}

fn build_sceneapp_metadata_root(
    descriptor: &SceneAppDescriptor,
    launch_intent: &SceneAppLaunchIntent,
) -> Map<String, Value> {
    let mut root = Map::new();
    root.insert(
        "sceneapp".to_string(),
        build_sceneapp_metadata_sceneapp_value(descriptor),
    );

    if descriptor.linked_service_skill_id.is_some() || descriptor.linked_scene_key.is_some() {
        root.insert(
            "service_skill".to_string(),
            json!({
                "id": descriptor.linked_service_skill_id.clone(),
                "scene_key": descriptor.linked_scene_key.clone(),
            }),
        );
    }

    root.insert(
        "harness".to_string(),
        Value::Object(build_sceneapp_harness_map(descriptor, launch_intent)),
    );

    if !launch_intent.slots.is_empty() {
        root.insert(
            "sceneapp_slots".to_string(),
            json!(launch_intent.slots.clone()),
        );
    }

    root
}

fn extract_launch_slot(launch_intent: &SceneAppLaunchIntent, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        launch_intent
            .slots
            .get(*key)
            .map(String::as_str)
            .and_then(|value| normalize_optional_string(Some(value)))
    })
}

fn extract_first_url_candidate(value: &str) -> Option<String> {
    value
        .split_whitespace()
        .find(|segment| segment.starts_with("http://") || segment.starts_with("https://"))
        .map(|segment| {
            segment
                .trim_end_matches(|ch: char| {
                    matches!(
                        ch,
                        '"' | '\'' | ')' | ']' | '}' | ',' | '.' | '>' | '，' | '。' | '）'
                    )
                })
                .to_string()
        })
        .filter(|segment| !segment.is_empty())
}

fn browser_assist_adapter_name(descriptor: &SceneAppDescriptor) -> Option<&'static str> {
    match descriptor.id.as_str() {
        "x-article-export" => Some("x/article-export"),
        _ => None,
    }
}

fn build_browser_assist_args(
    descriptor: &SceneAppDescriptor,
    launch_intent: &SceneAppLaunchIntent,
) -> Map<String, Value> {
    let mut args = Map::new();

    if descriptor.id == "x-article-export" {
        if let Some(url) =
            extract_launch_slot(launch_intent, &["article_url", "url"]).or_else(|| {
                launch_intent
                    .user_input
                    .as_deref()
                    .and_then(extract_first_url_candidate)
            })
        {
            args.insert("url".to_string(), json!(url));
        }

        if let Some(target_language) =
            extract_launch_slot(launch_intent, &["target_language", "language"])
        {
            args.insert("target_language".to_string(), json!(target_language));
        }
    }

    if args.is_empty() {
        if let Some(user_input) = normalize_optional_string(launch_intent.user_input.as_deref()) {
            args.insert("prompt".to_string(), json!(user_input));
        }
        if !launch_intent.slots.is_empty() {
            args.insert("slots".to_string(), json!(launch_intent.slots.clone()));
        }
    }

    args
}

fn build_sceneapp_runtime_request_metadata(
    descriptor: &SceneAppDescriptor,
    launch_intent: &SceneAppLaunchIntent,
    adapter_kind: &SceneAppBindingFamily,
) -> Map<String, Value> {
    let mut root = build_sceneapp_metadata_root(descriptor, launch_intent);
    let Some(Value::Object(harness)) = root.get_mut("harness") else {
        return root;
    };

    match adapter_kind {
        SceneAppBindingFamily::CloudScene => {
            harness.insert(
                "service_scene_launch".to_string(),
                json!({
                    "kind": "cloud_scene",
                    "service_scene_run": {
                        "sceneapp_id": descriptor.id.clone(),
                        "scene_key": descriptor.linked_scene_key.clone(),
                        "linked_skill_id": descriptor.linked_service_skill_id.clone(),
                        "skill_id": descriptor.linked_service_skill_id.clone(),
                        "skill_title": descriptor.title.clone(),
                        "skill_summary": descriptor.summary.clone(),
                        "execution_kind": "cloud_scene",
                        "entry_source": launch_intent.entry_source.clone().unwrap_or_else(|| "sceneapp_plan".to_string()),
                        "workspace_id": launch_intent.workspace_id.clone(),
                        "project_id": launch_intent.project_id.clone(),
                        "user_input": launch_intent.user_input.clone(),
                        "slots": launch_intent.slots.clone(),
                    }
                }),
            );
        }
        SceneAppBindingFamily::BrowserAssist => {
            let adapter_name = browser_assist_adapter_name(descriptor)
                .map(str::to_string)
                .or_else(|| descriptor.linked_scene_key.clone())
                .unwrap_or_else(|| descriptor.id.clone());
            let args = build_browser_assist_args(descriptor, launch_intent);

            harness.insert("browser_requirement".to_string(), json!("required"));
            harness.insert(
                "browser_requirement_reason".to_string(),
                json!("当前 SceneApp 依赖真实浏览器上下文与登录态，不应回退到纯 WebSearch。"),
            );
            harness.insert(
                "browser_assist".to_string(),
                json!({
                    "enabled": true,
                    "profile_key": GENERAL_BROWSER_ASSIST_PROFILE_KEY,
                    "preferred_backend": "lime_extension_bridge",
                    "auto_launch": false,
                    "stream_mode": "both",
                }),
            );
            harness.insert(
                "service_skill_launch".to_string(),
                json!({
                    "kind": "site_adapter",
                    "skill_id": descriptor.linked_service_skill_id.clone(),
                    "skill_title": descriptor.title.clone(),
                    "adapter_name": adapter_name,
                    "args": Value::Object(args),
                    "save_mode": "project_resource",
                    "project_id": launch_intent.project_id.clone(),
                }),
            );
        }
        SceneAppBindingFamily::AutomationJob => {
            harness.insert(
                "sceneapp_runtime_action".to_string(),
                json!("create_automation_job"),
            );
        }
        SceneAppBindingFamily::NativeSkill => {
            harness.insert(
                "sceneapp_runtime_action".to_string(),
                json!("launch_native_skill"),
            );
            harness.insert(
                "sceneapp_native_skill_launch".to_string(),
                json!({
                    "skill_id": descriptor.linked_service_skill_id.clone(),
                    "skill_key": descriptor.linked_scene_key.clone(),
                    "project_id": launch_intent.project_id.clone(),
                    "workspace_id": launch_intent.workspace_id.clone(),
                    "user_input": launch_intent.user_input.clone(),
                    "slots": launch_intent.slots.clone(),
                }),
            );
        }
        SceneAppBindingFamily::AgentTurn => {
            harness.insert(
                "sceneapp_runtime_action".to_string(),
                json!("submit_agent_turn"),
            );
        }
    }

    root
}

fn run_status_from_agent_run(status: &AgentRunStatus) -> SceneAppRunStatus {
    match status {
        AgentRunStatus::Queued => SceneAppRunStatus::Queued,
        AgentRunStatus::Running => SceneAppRunStatus::Running,
        AgentRunStatus::Success => SceneAppRunStatus::Success,
        AgentRunStatus::Error => SceneAppRunStatus::Error,
        AgentRunStatus::Canceled => SceneAppRunStatus::Canceled,
        AgentRunStatus::Timeout => SceneAppRunStatus::Timeout,
    }
}

fn run_status_from_job_status(status: Option<&str>) -> SceneAppRunStatus {
    match status.unwrap_or("queued") {
        "running" => SceneAppRunStatus::Running,
        "success" => SceneAppRunStatus::Success,
        "error" | "failed" => SceneAppRunStatus::Error,
        "canceled" => SceneAppRunStatus::Canceled,
        "timeout" => SceneAppRunStatus::Timeout,
        _ => SceneAppRunStatus::Queued,
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
struct SceneAppDeliveryState {
    required_parts: Vec<String>,
    completed_parts: Vec<String>,
    missing_parts: Vec<String>,
    completion_rate: Option<f64>,
    part_coverage_known: bool,
    failure_signal: Option<String>,
}

fn round_percentage(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn count_delivery_artifacts(value: &Value) -> usize {
    match value.get("delivery").and_then(Value::as_object) {
        Some(delivery)
            if delivery
                .get("success")
                .and_then(Value::as_bool)
                .unwrap_or(false) =>
        {
            1
        }
        _ => 0,
    }
}

fn extract_delivery_success_from_metadata_value(value: &Value) -> bool {
    value
        .get("delivery")
        .and_then(Value::as_object)
        .and_then(|delivery| delivery.get("success"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn read_string_array(value: &Value, path: &[&str]) -> Vec<String> {
    extract_nested_value(value, path)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|item| normalize_optional_string(Some(item)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn extract_artifact_paths_from_metadata_value(value: &Value) -> Vec<String> {
    let mut paths = Vec::new();
    for candidate in [
        read_string_array(value, &["artifact_paths"]),
        read_string_array(value, &["request_metadata", "artifact_paths"]),
        read_string_array(value, &["snapshot_metadata", "artifact_paths"]),
    ] {
        paths.extend(candidate);
    }

    let mut deduped = BTreeSet::new();
    paths
        .into_iter()
        .filter(|path| deduped.insert(path.clone()))
        .collect()
}

fn extract_sceneapp_project_context_from_metadata_value(
    parsed: &Value,
) -> (Option<String>, Option<String>) {
    let candidates = [
        parsed.get("harness"),
        extract_nested_value(parsed, &["request_metadata", "harness"]),
        parsed.get("sceneapp_launch"),
        parsed.get("sceneappLaunch"),
        extract_nested_value(parsed, &["harness", "sceneapp_launch"]),
        extract_nested_value(parsed, &["harness", "sceneappLaunch"]),
        extract_nested_value(parsed, &["request_metadata", "sceneapp_launch"]),
        extract_nested_value(parsed, &["request_metadata", "sceneappLaunch"]),
        extract_nested_value(parsed, &["request_metadata", "harness", "sceneapp_launch"]),
        extract_nested_value(parsed, &["request_metadata", "harness", "sceneappLaunch"]),
        extract_nested_value(parsed, &["harness", "service_skill_launch"]),
        extract_nested_value(parsed, &["harness", "serviceSkillLaunch"]),
        extract_nested_value(
            parsed,
            &["request_metadata", "harness", "service_skill_launch"],
        ),
        extract_nested_value(
            parsed,
            &["request_metadata", "harness", "serviceSkillLaunch"],
        ),
        extract_nested_value(parsed, &["harness", "service_scene_launch"]),
        extract_nested_value(parsed, &["harness", "serviceSceneLaunch"]),
        extract_nested_value(
            parsed,
            &["request_metadata", "harness", "service_scene_launch"],
        ),
        extract_nested_value(
            parsed,
            &["request_metadata", "harness", "serviceSceneLaunch"],
        ),
        extract_nested_value(parsed, &["harness", "sceneapp_native_skill_launch"]),
        extract_nested_value(parsed, &["harness", "sceneappNativeSkillLaunch"]),
        extract_nested_value(
            parsed,
            &[
                "request_metadata",
                "harness",
                "sceneapp_native_skill_launch",
            ],
        ),
        extract_nested_value(
            parsed,
            &["request_metadata", "harness", "sceneappNativeSkillLaunch"],
        ),
    ];

    (
        read_first_string_from_value_objects(candidates.as_slice(), &["project_id", "projectId"]),
        read_first_string_from_value_objects(
            candidates.as_slice(),
            &["workspace_id", "workspaceId"],
        ),
    )
}

fn normalize_match_token(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace('\\', "/")
}

fn part_alias_candidates(part: &str) -> Vec<String> {
    let normalized = normalize_match_token(part);
    if normalized.is_empty() {
        return Vec::new();
    }

    let basename = normalized
        .rsplit('/')
        .next()
        .map(str::to_string)
        .unwrap_or_else(|| normalized.clone());
    let stem = basename
        .split('.')
        .next()
        .map(str::to_string)
        .unwrap_or_else(|| basename.clone());
    let token_aliases = normalized
        .split(|ch: char| matches!(ch, '/' | '_' | '-' | '.'))
        .map(str::trim)
        .filter(|token| token.len() >= 3)
        .filter(|token| !matches!(*token, "json" | "yaml" | "yml" | "txt" | "md"))
        .map(str::to_string)
        .collect::<Vec<_>>();

    let custom_aliases = match normalized.as_str() {
        "brief" => vec!["summary", "outline", "task-brief"],
        "storyboard" => vec!["wireframe", "shotlist", "scene-board"],
        "script" => vec!["narration", "copy"],
        "music_refs" => vec!["music", "bgm", "soundtrack"],
        "video_draft" => vec!["video", "roughcut", "mp4", "movie"],
        "review_note" => vec!["review", "qa", "feedback", "approval"],
        "index.md" => vec!["index", "readme", "article"],
        "meta.json" => vec!["meta", "metadata"],
        "storyboard.json" => vec!["storyboard", "wireframe"],
        "timeline.json" => vec!["timeline"],
        "audio.mp3" => vec!["audio", "voice", "mp3"],
        "media.json" => vec!["media"],
        "form.json" => vec!["form"],
        _ => Vec::new(),
    };

    let mut deduped = BTreeSet::new();
    std::iter::once(normalized)
        .chain(std::iter::once(basename))
        .chain(std::iter::once(stem))
        .chain(token_aliases)
        .chain(custom_aliases.into_iter().map(str::to_string))
        .filter(|alias| alias.len() >= 3)
        .filter(|alias| deduped.insert(alias.clone()))
        .collect()
}

fn path_matches_part(path: &str, part: &str) -> bool {
    let normalized_path = normalize_match_token(path);
    if normalized_path.is_empty() {
        return false;
    }

    part_alias_candidates(part)
        .into_iter()
        .any(|candidate| normalized_path.contains(&candidate))
}

fn resolve_sceneapp_artifact_absolute_path(
    workspace_root: Option<&str>,
    path: &str,
) -> Option<String> {
    let normalized_path = normalize_optional_string(Some(path))?;
    let candidate = PathBuf::from(&normalized_path);
    if candidate.is_absolute() {
        return Some(candidate.to_string_lossy().to_string());
    }

    let normalized_root = normalize_optional_string(workspace_root)?;
    Some(
        PathBuf::from(normalized_root)
            .join(normalized_path.replace('/', std::path::MAIN_SEPARATOR_STR))
            .to_string_lossy()
            .to_string(),
    )
}

fn build_sceneapp_delivery_artifact_refs(
    descriptor: Option<&SceneAppDescriptor>,
    artifact_paths: &[String],
    project_id: Option<&str>,
    workspace_id: Option<&str>,
    workspace_root: Option<&str>,
    source: &str,
) -> Vec<SceneAppDeliveryArtifactRef> {
    let required_parts = descriptor
        .and_then(|item| item.delivery_profile.as_ref())
        .map(|profile| profile.required_parts.clone())
        .unwrap_or_default();
    let mut seen_paths = BTreeSet::new();

    artifact_paths
        .iter()
        .filter_map(|path| {
            let relative_path = normalize_optional_string(Some(path.as_str()))?;
            if !seen_paths.insert(relative_path.clone()) {
                return None;
            }

            let part_key = required_parts
                .iter()
                .find(|part| path_matches_part(relative_path.as_str(), part.as_str()))
                .cloned();

            Some(SceneAppDeliveryArtifactRef {
                relative_path: relative_path.clone(),
                absolute_path: resolve_sceneapp_artifact_absolute_path(
                    workspace_root,
                    relative_path.as_str(),
                ),
                part_key,
                project_id: normalize_optional_string(project_id),
                workspace_id: normalize_optional_string(workspace_id),
                source: source.to_string(),
            })
        })
        .collect()
}

fn build_sceneapp_session_relative_path(session_id: &str, suffix: &str) -> String {
    format!("{SCENEAPP_RUNTIME_SESSION_RELATIVE_ROOT}/{session_id}/{suffix}")
}

fn build_sceneapp_governance_artifact_ref(
    kind: SceneAppGovernanceArtifactKind,
    label: &str,
    session_id: &str,
    suffix: &str,
    project_id: Option<&str>,
    workspace_id: Option<&str>,
    workspace_root: Option<&str>,
) -> SceneAppGovernanceArtifactRef {
    let relative_path = build_sceneapp_session_relative_path(session_id, suffix);

    SceneAppGovernanceArtifactRef {
        kind,
        label: label.to_string(),
        absolute_path: resolve_sceneapp_artifact_absolute_path(
            workspace_root,
            relative_path.as_str(),
        ),
        relative_path,
        project_id: normalize_optional_string(project_id),
        workspace_id: normalize_optional_string(workspace_id),
        source: "session_governance".to_string(),
    }
}

fn build_sceneapp_governance_artifact_refs(
    session_id: Option<&str>,
    project_id: Option<&str>,
    workspace_id: Option<&str>,
    workspace_root: Option<&str>,
) -> Vec<SceneAppGovernanceArtifactRef> {
    let Some(session_id) = normalize_optional_string(session_id) else {
        return Vec::new();
    };

    vec![
        build_sceneapp_governance_artifact_ref(
            SceneAppGovernanceArtifactKind::EvidenceSummary,
            "证据摘要",
            session_id.as_str(),
            SCENEAPP_EVIDENCE_SUMMARY_RELATIVE_PATH,
            project_id,
            workspace_id,
            workspace_root,
        ),
        build_sceneapp_governance_artifact_ref(
            SceneAppGovernanceArtifactKind::ReviewDecisionMarkdown,
            "人工复核记录",
            session_id.as_str(),
            SCENEAPP_REVIEW_DECISION_MARKDOWN_RELATIVE_PATH,
            project_id,
            workspace_id,
            workspace_root,
        ),
        build_sceneapp_governance_artifact_ref(
            SceneAppGovernanceArtifactKind::ReviewDecisionJson,
            "复核 JSON",
            session_id.as_str(),
            SCENEAPP_REVIEW_DECISION_JSON_RELATIVE_PATH,
            project_id,
            workspace_id,
            workspace_root,
        ),
    ]
}

fn is_review_part(part: &str) -> bool {
    let normalized = normalize_match_token(part);
    ["review", "qa", "approval", "approve", "feedback", "check"]
        .iter()
        .any(|token| normalized.contains(token))
}

fn is_planning_part(part: &str) -> bool {
    let normalized = normalize_match_token(part);
    [
        "brief",
        "storyboard",
        "script",
        "outline",
        "music",
        "meta",
        "timeline",
        "plan",
        "summary",
    ]
    .iter()
    .any(|token| normalized.contains(token))
}

fn is_publish_part(part: &str) -> bool {
    let normalized = normalize_match_token(part);
    [
        "publish", "video", "audio", "poster", "cover", "media", "index", "article", "report",
        "document", "output", "form", "draft", "final",
    ]
    .iter()
    .any(|token| normalized.contains(token))
}

fn infer_review_parts(descriptor: &SceneAppDescriptor) -> Vec<String> {
    descriptor
        .delivery_profile
        .as_ref()
        .map(|profile| {
            profile
                .required_parts
                .iter()
                .filter(|part| is_review_part(part))
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn infer_publish_parts(descriptor: &SceneAppDescriptor) -> Vec<String> {
    let mut candidates = descriptor
        .composition_profile
        .as_ref()
        .and_then(|profile| {
            profile
                .steps
                .iter()
                .rev()
                .find(|step| !is_review_part(&step.id) && !is_planning_part(&step.id))
                .map(|step| vec![step.id.clone()])
                .or_else(|| {
                    profile
                        .steps
                        .iter()
                        .rev()
                        .find(|step| !is_review_part(&step.id))
                        .map(|step| vec![step.id.clone()])
                })
        })
        .unwrap_or_default();

    if candidates.is_empty() {
        let required_parts = descriptor
            .delivery_profile
            .as_ref()
            .map(|profile| profile.required_parts.clone())
            .unwrap_or_default();
        candidates = required_parts
            .iter()
            .filter(|part| !is_review_part(part) && is_publish_part(part))
            .cloned()
            .collect::<Vec<_>>();

        if candidates.is_empty() {
            if let Some(primary_part) = descriptor
                .delivery_profile
                .as_ref()
                .and_then(|profile| profile.primary_part.clone())
                .filter(|part| !is_review_part(part))
            {
                candidates.push(primary_part);
            } else if let Some(last_non_review) = required_parts
                .iter()
                .rev()
                .find(|part| !is_review_part(part))
                .cloned()
            {
                candidates.push(last_non_review);
            }
        }
    }

    let mut deduped = BTreeSet::new();
    candidates
        .into_iter()
        .filter(|part| deduped.insert(part.clone()))
        .collect()
}

fn build_sceneapp_delivery_state(
    descriptor: Option<&SceneAppDescriptor>,
    status: &SceneAppRunStatus,
    artifact_paths: &[String],
    artifact_count: usize,
    delivery_success: bool,
    artifact_coverage_known: bool,
    verification_failure_outcomes: &[String],
) -> SceneAppDeliveryState {
    let Some(descriptor) = descriptor else {
        return SceneAppDeliveryState::default();
    };

    let required_parts = descriptor
        .delivery_profile
        .as_ref()
        .map(|profile| profile.required_parts.clone())
        .unwrap_or_default();
    if required_parts.is_empty() {
        return SceneAppDeliveryState {
            failure_signal: if !verification_failure_outcomes.is_empty()
                && descriptor.delivery_contract == SceneAppDeliveryContract::ProjectPack
            {
                Some("review_blocked".to_string())
            } else if matches!(status, SceneAppRunStatus::Timeout)
                && descriptor
                    .scorecard_profile
                    .as_ref()
                    .is_some_and(|profile| {
                        profile
                            .failure_signals
                            .iter()
                            .any(|signal| signal == "automation_timeout")
                    })
            {
                Some("automation_timeout".to_string())
            } else {
                None
            },
            ..SceneAppDeliveryState::default()
        };
    }

    let mut completed_parts = required_parts
        .iter()
        .filter(|part| {
            artifact_paths
                .iter()
                .any(|path| path_matches_part(path, part))
        })
        .cloned()
        .collect::<Vec<_>>();

    let part_coverage_known = if artifact_coverage_known {
        true
    } else if artifact_paths.is_empty() {
        if delivery_success && required_parts.len() == 1 {
            completed_parts = vec![required_parts[0].clone()];
            true
        } else {
            false
        }
    } else {
        true
    };

    let mut completed_dedup = BTreeSet::new();
    completed_parts.retain(|part| completed_dedup.insert(part.clone()));

    let missing_parts = if part_coverage_known {
        required_parts
            .iter()
            .filter(|part| !completed_parts.contains(part))
            .cloned()
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let completion_rate = if part_coverage_known {
        Some(round_percentage(
            (completed_parts.len() as f64 / required_parts.len() as f64) * 100.0,
        ))
    } else {
        None
    };

    let review_parts = infer_review_parts(descriptor);
    let publish_parts = infer_publish_parts(descriptor);
    let missing_part_set = missing_parts.iter().cloned().collect::<BTreeSet<_>>();

    let failure_signal = if descriptor.delivery_contract == SceneAppDeliveryContract::ProjectPack {
        if !verification_failure_outcomes.is_empty() {
            Some("review_blocked".to_string())
        } else if matches!(status, SceneAppRunStatus::Timeout)
            && descriptor
                .scorecard_profile
                .as_ref()
                .is_some_and(|profile| {
                    profile
                        .failure_signals
                        .iter()
                        .any(|signal| signal == "automation_timeout")
                })
        {
            Some("automation_timeout".to_string())
        } else if part_coverage_known && completed_parts.is_empty() {
            Some("pack_incomplete".to_string())
        } else if review_parts
            .iter()
            .any(|part| missing_part_set.contains(part))
        {
            Some("review_blocked".to_string())
        } else if publish_parts
            .iter()
            .any(|part| missing_part_set.contains(part))
        {
            Some("publish_stalled".to_string())
        } else if part_coverage_known && !missing_parts.is_empty() {
            Some("pack_incomplete".to_string())
        } else if !part_coverage_known
            && (artifact_count == 0
                || matches!(
                    status,
                    SceneAppRunStatus::Error
                        | SceneAppRunStatus::Canceled
                        | SceneAppRunStatus::Timeout
                ))
        {
            Some("pack_incomplete".to_string())
        } else {
            None
        }
    } else if matches!(status, SceneAppRunStatus::Timeout)
        && descriptor
            .scorecard_profile
            .as_ref()
            .is_some_and(|profile| {
                profile
                    .failure_signals
                    .iter()
                    .any(|signal| signal == "automation_timeout")
            })
    {
        Some("automation_timeout".to_string())
    } else if part_coverage_known && !missing_parts.is_empty() {
        Some("pack_incomplete".to_string())
    } else {
        None
    };

    SceneAppDeliveryState {
        required_parts,
        completed_parts,
        missing_parts,
        completion_rate,
        part_coverage_known,
        failure_signal,
    }
}

fn load_sceneapp_run_runtime_evidence(
    db: &DbConnection,
    run: &AgentRun,
) -> Option<RuntimeEvidenceSceneAppSnapshot> {
    let context = load_sceneapp_run_export_context(db, run).ok()?;

    Some(build_runtime_evidence_sceneapp_snapshot(
        &context.detail,
        &context.thread_read,
        Some(context.workspace_root.as_path()),
    ))
}

fn build_sceneapp_run_thread_read(
    db: &DbConnection,
    detail: &crate::agent::SessionDetail,
) -> AgentRuntimeThreadReadModel {
    sync_thread_reliability_projection(db, detail)
        .map(|projection| {
            AgentRuntimeThreadReadModel::from_parts(
                detail,
                &[],
                projection.pending_requests,
                projection.last_outcome,
                projection.incidents,
                None,
            )
        })
        .unwrap_or_else(|_| AgentRuntimeThreadReadModel::from_session_detail(detail, &[]))
}

fn load_sceneapp_run_export_context(
    db: &DbConnection,
    run: &AgentRun,
) -> Result<SceneAppRunExportContext, String> {
    let session_id = normalize_optional_string(run.session_id.as_deref())
        .ok_or_else(|| "当前运行缺少 sessionId，无法导出治理制品".to_string())?;
    let mut detail = AsterAgentWrapper::get_session_sync(db, session_id.as_str())
        .map_err(|error| format!("读取 SceneApp 运行会话失败: {error}"))?;
    narrow_session_detail_to_run_window(&mut detail, run);
    let thread_read = build_sceneapp_run_thread_read(db, &detail);
    let workspace_root = resolve_runtime_export_workspace_root(db, &detail)?;

    Ok(SceneAppRunExportContext {
        detail,
        thread_read,
        workspace_root,
    })
}

pub fn prepare_sceneapp_run_governance_artifact(
    db: &DbConnection,
    run: &AgentRun,
    kind: &SceneAppGovernanceArtifactKind,
) -> Result<(), String> {
    let context = load_sceneapp_run_export_context(db, run)?;

    match kind {
        SceneAppGovernanceArtifactKind::EvidenceSummary => {
            export_runtime_evidence_pack(
                &context.detail,
                &context.thread_read,
                context.workspace_root.as_path(),
            )?;
        }
        SceneAppGovernanceArtifactKind::ReviewDecisionMarkdown
        | SceneAppGovernanceArtifactKind::ReviewDecisionJson => {
            export_runtime_review_decision_template(
                &context.detail,
                &context.thread_read,
                context.workspace_root.as_path(),
            )?;
        }
    }

    Ok(())
}

fn narrow_session_detail_to_run_window(detail: &mut crate::agent::SessionDetail, run: &AgentRun) {
    let started_at = run.started_at.as_str();
    let finished_at = run.finished_at.as_deref();
    detail
        .items
        .retain(|item| timestamp_in_run_window(item.updated_at.as_str(), started_at, finished_at));

    let allowed_turn_ids = detail
        .items
        .iter()
        .map(|item| item.turn_id.clone())
        .collect::<BTreeSet<_>>();
    detail.turns.retain(|turn| {
        allowed_turn_ids.contains(turn.id.as_str())
            || timestamp_in_run_window(turn.updated_at.as_str(), started_at, finished_at)
    });
}

fn timestamp_in_run_window(timestamp: &str, started_at: &str, finished_at: Option<&str>) -> bool {
    let Some(timestamp) = parse_rfc3339_utc(timestamp) else {
        return true;
    };
    let Some(started_at) = parse_rfc3339_utc(started_at) else {
        return true;
    };
    if timestamp < started_at {
        return false;
    }

    if let Some(finished_at) = finished_at.and_then(parse_rfc3339_utc) {
        return timestamp <= finished_at;
    }

    true
}

fn parse_rfc3339_utc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value.trim())
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

fn extract_nested_value<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    Some(current)
}

fn read_first_string_from_value_objects(
    candidates: &[Option<&Value>],
    keys: &[&str],
) -> Option<String> {
    candidates.iter().find_map(|candidate| {
        let object = candidate.and_then(|value| value.as_object())?;
        keys.iter().find_map(|key| {
            object
                .get(*key)
                .and_then(Value::as_str)
                .and_then(|value| normalize_optional_string(Some(value)))
        })
    })
}

fn read_string_map_from_value_objects(
    candidates: &[Option<&Value>],
    keys: &[&str],
) -> BTreeMap<String, String> {
    candidates
        .iter()
        .find_map(|candidate| {
            let object = candidate.and_then(|value| value.as_object())?;
            let slot_object = keys
                .iter()
                .find_map(|key| object.get(*key))
                .and_then(Value::as_object)?;

            let normalized = slot_object
                .iter()
                .filter_map(|(key, value)| {
                    let normalized_key = normalize_optional_string(Some(key.as_str()))?;
                    let normalized_value =
                        normalize_optional_string(value.as_str().map(str::trim))?;
                    Some((normalized_key, normalized_value))
                })
                .collect::<BTreeMap<_, _>>();

            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        })
        .unwrap_or_default()
}

fn read_nested_launch_context<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| object.get(*key))
}

fn extract_cloud_scene_runtime_ref_from_metadata_value(
    parsed: &Value,
) -> Option<SceneAppCloudSceneRuntimeRef> {
    let launch_candidates = [
        parsed.get("service_scene_launch"),
        parsed.get("serviceSceneLaunch"),
        extract_nested_value(parsed, &["harness", "service_scene_launch"]),
        extract_nested_value(parsed, &["harness", "serviceSceneLaunch"]),
        extract_nested_value(parsed, &["request_metadata", "service_scene_launch"]),
        extract_nested_value(parsed, &["request_metadata", "serviceSceneLaunch"]),
        extract_nested_value(
            parsed,
            &["request_metadata", "harness", "service_scene_launch"],
        ),
        extract_nested_value(
            parsed,
            &["request_metadata", "harness", "serviceSceneLaunch"],
        ),
    ];
    let context_candidates = launch_candidates
        .iter()
        .map(|candidate| {
            candidate.and_then(|value| {
                read_nested_launch_context(
                    value,
                    &[
                        "service_scene_run",
                        "serviceSceneRun",
                        "request_context",
                        "requestContext",
                    ],
                )
                .or(Some(value))
            })
        })
        .collect::<Vec<_>>();
    let candidates = context_candidates.as_slice();

    let scene_key = read_first_string_from_value_objects(candidates, &["scene_key", "sceneKey"]);
    let skill_id = read_first_string_from_value_objects(
        candidates,
        &["skill_id", "skillId", "linked_skill_id", "linkedSkillId"],
    );
    let project_id = read_first_string_from_value_objects(candidates, &["project_id", "projectId"]);
    let content_id = read_first_string_from_value_objects(candidates, &["content_id", "contentId"]);
    let workspace_id =
        read_first_string_from_value_objects(candidates, &["workspace_id", "workspaceId"]);
    let entry_source =
        read_first_string_from_value_objects(candidates, &["entry_source", "entrySource"]);
    let user_input = read_first_string_from_value_objects(candidates, &["user_input", "userInput"]);
    let slots = read_string_map_from_value_objects(candidates, &["slots"]);

    if scene_key.is_none()
        && skill_id.is_none()
        && project_id.is_none()
        && content_id.is_none()
        && workspace_id.is_none()
        && entry_source.is_none()
        && user_input.is_none()
        && slots.is_empty()
    {
        return None;
    }

    Some(SceneAppCloudSceneRuntimeRef {
        scene_key,
        skill_id,
        project_id,
        content_id,
        workspace_id,
        entry_source,
        user_input,
        slots,
    })
}

fn extract_native_skill_runtime_ref_from_metadata_value(
    parsed: &Value,
) -> Option<SceneAppNativeSkillRuntimeRef> {
    let candidates = [
        parsed.get("sceneapp_native_skill_launch"),
        parsed.get("sceneappNativeSkillLaunch"),
        extract_nested_value(parsed, &["harness", "sceneapp_native_skill_launch"]),
        extract_nested_value(parsed, &["harness", "sceneappNativeSkillLaunch"]),
        extract_nested_value(
            parsed,
            &["request_metadata", "sceneapp_native_skill_launch"],
        ),
        extract_nested_value(parsed, &["request_metadata", "sceneappNativeSkillLaunch"]),
        extract_nested_value(
            parsed,
            &[
                "request_metadata",
                "harness",
                "sceneapp_native_skill_launch",
            ],
        ),
        extract_nested_value(
            parsed,
            &["request_metadata", "harness", "sceneappNativeSkillLaunch"],
        ),
    ];

    let skill_id =
        read_first_string_from_value_objects(candidates.as_slice(), &["skill_id", "skillId"]);
    let skill_key =
        read_first_string_from_value_objects(candidates.as_slice(), &["skill_key", "skillKey"]);
    let project_id =
        read_first_string_from_value_objects(candidates.as_slice(), &["project_id", "projectId"]);
    let workspace_id = read_first_string_from_value_objects(
        candidates.as_slice(),
        &["workspace_id", "workspaceId"],
    );
    let user_input =
        read_first_string_from_value_objects(candidates.as_slice(), &["user_input", "userInput"]);
    let slots = read_string_map_from_value_objects(candidates.as_slice(), &["slots"]);

    if skill_id.is_none() && skill_key.is_none() && slots.is_empty() {
        return None;
    }

    Some(SceneAppNativeSkillRuntimeRef {
        skill_id,
        skill_key,
        project_id,
        workspace_id,
        user_input,
        slots,
    })
}

fn extract_browser_runtime_ref_from_metadata_value(
    parsed: &Value,
) -> Option<SceneAppBrowserRuntimeRef> {
    let candidates = [
        parsed.get("browser_runtime_ref"),
        parsed.get("browserRuntimeRef"),
        parsed.get("browser_session"),
        parsed.get("browserSession"),
        parsed.get("browser_assist"),
        parsed.get("browserAssist"),
        extract_nested_value(parsed, &["request_metadata", "browser_runtime_ref"]),
        extract_nested_value(parsed, &["request_metadata", "browserRuntimeRef"]),
        extract_nested_value(parsed, &["request_metadata", "browser_session"]),
        extract_nested_value(parsed, &["request_metadata", "browserSession"]),
        extract_nested_value(parsed, &["request_metadata", "browser_assist"]),
        extract_nested_value(parsed, &["request_metadata", "browserAssist"]),
        extract_nested_value(parsed, &["request_metadata", "harness", "browser_assist"]),
        extract_nested_value(parsed, &["request_metadata", "harness", "browserAssist"]),
    ];

    let profile_key =
        read_first_string_from_value_objects(&candidates, &["profile_key", "profileKey"]);
    let session_id =
        read_first_string_from_value_objects(&candidates, &["session_id", "sessionId"]);
    let target_id = read_first_string_from_value_objects(&candidates, &["target_id", "targetId"]);

    if profile_key.is_none() && session_id.is_none() && target_id.is_none() {
        return None;
    }

    Some(SceneAppBrowserRuntimeRef {
        profile_key,
        session_id,
        target_id,
    })
}

fn ensure_automation_supported(descriptor: &SceneAppDescriptor) -> Result<(), String> {
    let requires_browser = descriptor.launch_requirements.iter().any(|requirement| {
        matches!(
            requirement.kind,
            SceneAppLaunchRequirementKind::BrowserSession
        )
    });
    let uses_browser_binding = descriptor
        .entry_bindings
        .iter()
        .any(|binding| matches!(binding.binding_family, SceneAppBindingFamily::BrowserAssist));

    if requires_browser || uses_browser_binding {
        return Err("当前 SceneApp 依赖浏览器上下文，暂不支持直接转为 automation job".to_string());
    }

    Ok(())
}

fn ensure_required_inputs(
    descriptor: &SceneAppDescriptor,
    launch_intent: &SceneAppLaunchIntent,
) -> Result<(), String> {
    let missing_user_input =
        descriptor.launch_requirements.iter().any(|requirement| {
            matches!(requirement.kind, SceneAppLaunchRequirementKind::UserInput)
        }) && !launch_intent
            .user_input
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            && !launch_intent
                .slots
                .values()
                .any(|value| !value.trim().is_empty());
    if missing_user_input {
        return Err("当前 SceneApp 缺少必填输入，无法创建自动化任务".to_string());
    }

    let missing_project = descriptor
        .launch_requirements
        .iter()
        .any(|requirement| matches!(requirement.kind, SceneAppLaunchRequirementKind::Project))
        && !launch_intent
            .project_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
    if missing_project {
        return Err("当前 SceneApp 需要 project_id 才能创建自动化任务".to_string());
    }

    if !launch_intent
        .workspace_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err("创建 SceneApp 自动化任务时必须提供 workspace_id".to_string());
    }

    Ok(())
}

fn build_sceneapp_request_metadata(
    descriptor: &SceneAppDescriptor,
    intent: &SceneAppAutomationIntent,
) -> Value {
    Value::Object(build_sceneapp_metadata_root(
        descriptor,
        &intent.launch_intent,
    ))
}

fn build_sceneapp_runtime_action(binding_family: &SceneAppBindingFamily) -> SceneAppRuntimeAction {
    match binding_family {
        SceneAppBindingFamily::AgentTurn => SceneAppRuntimeAction::SubmitAgentTurn,
        SceneAppBindingFamily::BrowserAssist => SceneAppRuntimeAction::LaunchBrowserAssist,
        SceneAppBindingFamily::AutomationJob => SceneAppRuntimeAction::CreateAutomationJob,
        SceneAppBindingFamily::CloudScene => SceneAppRuntimeAction::LaunchCloudScene,
        SceneAppBindingFamily::NativeSkill => SceneAppRuntimeAction::LaunchNativeSkill,
    }
}

pub fn build_sceneapp_runtime_adapter_plan(
    descriptor: &SceneAppDescriptor,
    launch_intent: &SceneAppLaunchIntent,
) -> SceneAppRuntimeAdapterPlan {
    let adapter_kind = primary_binding_family(descriptor);
    let runtime_action = build_sceneapp_runtime_action(&adapter_kind);
    let request_metadata = Value::Object(build_sceneapp_runtime_request_metadata(
        descriptor,
        launch_intent,
        &adapter_kind,
    ));

    let mut notes = vec![format!(
        "当前 SceneApp 规划先映射到 {} 主链，再由后续 runtime adapter 负责真实执行。",
        binding_family_to_string(&adapter_kind)
    )];

    let preferred_profile_key = match adapter_kind {
        SceneAppBindingFamily::BrowserAssist => {
            Some(GENERAL_BROWSER_ASSIST_PROFILE_KEY.to_string())
        }
        _ => None,
    };

    let target_ref = match adapter_kind {
        SceneAppBindingFamily::BrowserAssist => browser_assist_adapter_name(descriptor)
            .map(str::to_string)
            .or_else(|| descriptor.linked_scene_key.clone())
            .unwrap_or_else(|| descriptor.id.clone()),
        SceneAppBindingFamily::CloudScene
        | SceneAppBindingFamily::NativeSkill
        | SceneAppBindingFamily::AutomationJob => descriptor
            .linked_service_skill_id
            .clone()
            .or_else(|| descriptor.linked_scene_key.clone())
            .unwrap_or_else(|| descriptor.id.clone()),
        SceneAppBindingFamily::AgentTurn => descriptor.id.clone(),
    };

    let launch_payload = match adapter_kind {
        SceneAppBindingFamily::CloudScene => {
            if matches!(descriptor.sceneapp_type, SceneAppType::Hybrid) {
                notes.push(
                    "当前 SceneApp 属于 hybrid，但首发执行仍先收敛到 cloud_scene；本地编排步骤由后续 composition blueprint 接续。"
                        .to_string(),
                );
            }

            json!({
                "sceneapp_id": descriptor.id.clone(),
                "scene_key": descriptor.linked_scene_key.clone(),
                "service_skill_id": descriptor.linked_service_skill_id.clone(),
                "workspace_id": launch_intent.workspace_id.clone(),
                "project_id": launch_intent.project_id.clone(),
                "entry_source": launch_intent.entry_source.clone().unwrap_or_else(|| "sceneapp_plan".to_string()),
                "user_input": launch_intent.user_input.clone(),
                "slots": launch_intent.slots.clone(),
            })
        }
        SceneAppBindingFamily::BrowserAssist => {
            let args = build_browser_assist_args(descriptor, launch_intent);
            if !args.contains_key("url") && descriptor.id == "x-article-export" {
                notes.push(
                    "当前 planner 还无法仅凭 descriptor 判断 article_url 是否齐备；执行前应继续通过 scene gate 补齐目标链接。"
                        .to_string(),
                );
            }

            json!({
                "sceneapp_id": descriptor.id.clone(),
                "service_skill_id": descriptor.linked_service_skill_id.clone(),
                "adapter_name": target_ref.clone(),
                "profile_key": preferred_profile_key.clone(),
                "args": Value::Object(args),
                "project_id": launch_intent.project_id.clone(),
                "workspace_id": launch_intent.workspace_id.clone(),
                "save_mode": "project_resource",
            })
        }
        SceneAppBindingFamily::AutomationJob => {
            notes.push("当前 planner 只生成 durable automation draft；具体 schedule、delivery 与 run-now 策略可继续由 UI 调整。".to_string());

            json!({
                "sceneapp_id": descriptor.id.clone(),
                "name": format!("{} 自动化", descriptor.title),
                "enabled": true,
                "execution_mode": "intelligent",
                "schedule": {
                    "kind": "every",
                    "every_secs": 3600,
                },
                "delivery": {
                    "mode": "none",
                    "channel": null,
                    "target": null,
                    "best_effort": false,
                    "output_schema": null,
                    "output_format": null,
                },
                "launch_intent": {
                    "sceneapp_id": launch_intent.sceneapp_id.clone(),
                    "entry_source": launch_intent.entry_source.clone(),
                    "workspace_id": launch_intent.workspace_id.clone(),
                    "project_id": launch_intent.project_id.clone(),
                    "user_input": launch_intent.user_input.clone(),
                    "slots": launch_intent.slots.clone(),
                    "runtime_context": launch_intent.runtime_context.clone(),
                },
            })
        }
        SceneAppBindingFamily::NativeSkill => {
            notes.push(
                "native_skill 目前仍建议由统一 SceneApp UI 继续补参后，再把 draft 投递给本地 skill 执行入口。"
                    .to_string(),
            );

            json!({
                "sceneapp_id": descriptor.id.clone(),
                "service_skill_id": descriptor.linked_service_skill_id.clone(),
                "skill_key": descriptor.linked_scene_key.clone(),
                "workspace_id": launch_intent.workspace_id.clone(),
                "project_id": launch_intent.project_id.clone(),
                "user_input": launch_intent.user_input.clone(),
                "slots": launch_intent.slots.clone(),
            })
        }
        SceneAppBindingFamily::AgentTurn => {
            notes.push(
                "agent_turn 类型 SceneApp 当前仍建议走统一聊天 turn，并把 sceneapp_launch metadata 合并进 request_metadata。"
                    .to_string(),
            );

            json!({
                "sceneapp_id": descriptor.id.clone(),
                "message": launch_intent.user_input.clone().unwrap_or_default(),
                "workspace_id": launch_intent.workspace_id.clone(),
                "project_id": launch_intent.project_id.clone(),
                "slots": launch_intent.slots.clone(),
            })
        }
    };

    SceneAppRuntimeAdapterPlan {
        adapter_kind,
        runtime_action,
        target_ref,
        target_label: descriptor.title.clone(),
        linked_service_skill_id: descriptor.linked_service_skill_id.clone(),
        linked_scene_key: descriptor.linked_scene_key.clone(),
        preferred_profile_key,
        request_metadata,
        launch_payload,
        notes,
    }
}

fn build_sceneapp_automation_prompt(
    descriptor: &SceneAppDescriptor,
    intent: &SceneAppAutomationIntent,
) -> String {
    let mut sections = vec![
        format!("SceneApp：{}", descriptor.title.as_str()),
        format!("场景摘要：{}", descriptor.summary.as_str()),
        format!(
            "运行形态：{}",
            sceneapp_type_to_string(&descriptor.sceneapp_type)
        ),
        format!(
            "模式组合：{}",
            descriptor
                .pattern_stack
                .iter()
                .map(pattern_to_string)
                .collect::<Vec<_>>()
                .join(" + ")
        ),
        format!(
            "交付合同：{}",
            delivery_contract_to_string(&descriptor.delivery_contract)
        ),
    ];

    if let Some(user_input) = normalize_optional_string(intent.launch_intent.user_input.as_deref())
    {
        sections.push(format!("用户目标：{user_input}"));
    }

    if !intent.launch_intent.slots.is_empty() {
        let slot_lines = intent
            .launch_intent
            .slots
            .iter()
            .map(|(key, value)| format!("- {key}: {value}"))
            .collect::<Vec<_>>()
            .join("\n");
        sections.push(format!("结构化补参：\n{slot_lines}"));
    }

    if let Some(project_id) = normalize_optional_string(intent.launch_intent.project_id.as_deref())
    {
        sections.push(format!("项目 ID：{project_id}"));
    }

    sections.push("请严格围绕上述 SceneApp 合同执行任务，并把结果沉淀为可复用资产。".to_string());
    sections.join("\n\n")
}

pub fn build_sceneapp_automation_draft(
    descriptor: &SceneAppDescriptor,
    intent: &SceneAppAutomationIntent,
) -> Result<AutomationJobDraft, String> {
    ensure_automation_supported(descriptor)?;
    ensure_required_inputs(descriptor, &intent.launch_intent)?;

    let workspace_id = intent
        .launch_intent
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "创建 SceneApp 自动化任务时必须提供 workspace_id".to_string())?
        .to_string();

    let job_name = normalize_optional_string(intent.name.as_deref())
        .unwrap_or_else(|| format!("{} 自动化", descriptor.title.as_str()));
    let description = normalize_optional_string(intent.description.as_deref()).or_else(|| {
        Some(format!(
            "由 SceneApp {} 派生的自动化任务，按统一 descriptor 与治理合同执行。",
            descriptor.title.as_str()
        ))
    });

    Ok(AutomationJobDraft {
        name: job_name,
        description,
        enabled: intent.enabled.unwrap_or(true),
        workspace_id,
        execution_mode: intent
            .execution_mode
            .unwrap_or(AutomationExecutionMode::Intelligent),
        schedule: intent
            .schedule
            .clone()
            .unwrap_or_else(default_sceneapp_schedule),
        payload: AutomationPayload::AgentTurn {
            prompt: build_sceneapp_automation_prompt(descriptor, intent),
            system_prompt: Some(format!(
                "你正在执行 SceneApp 自动化任务。binding_family={}，请优先遵守 SceneApp 合同和结果交付要求。",
                descriptor
                    .entry_bindings
                    .first()
                    .map(|binding| binding_family_to_string(&binding.binding_family))
                    .unwrap_or("agent_turn")
            )),
            web_search: false,
            request_metadata: Some(build_sceneapp_request_metadata(descriptor, intent)),
            content_id: None,
        },
        delivery: intent.delivery.clone().unwrap_or_else(default_sceneapp_delivery),
        timeout_secs: intent.timeout_secs,
        max_retries: intent.max_retries.unwrap_or(3),
    })
}

pub fn build_sceneapp_automation_result(
    descriptor: &SceneAppDescriptor,
    job: &AutomationJobRecord,
    run_now_result: Option<AutomationCycleResult>,
) -> SceneAppAutomationResult {
    SceneAppAutomationResult {
        sceneapp_id: descriptor.id.clone(),
        job_id: job.id.clone(),
        job_name: job.name.clone(),
        enabled: job.enabled,
        workspace_id: job.workspace_id.clone(),
        next_run_at: job.next_run_at.clone(),
        run_now_result: run_now_result.map(|result| SceneAppAutomationRunResult {
            job_count: result.job_count,
            success_count: result.success_count,
            failed_count: result.failed_count,
            timeout_count: result.timeout_count,
        }),
    }
}

pub fn extract_sceneapp_id_from_automation_job(job: &AutomationJobRecord) -> Option<String> {
    job.payload
        .as_object()
        .and_then(|payload| payload.get("request_metadata"))
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get("sceneapp"))
        .and_then(Value::as_object)
        .and_then(|sceneapp| sceneapp.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub fn extract_sceneapp_id_from_run_metadata(run: &AgentRun) -> Option<String> {
    let parsed = run
        .metadata
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())?;

    parsed
        .get("sceneapp")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            parsed
                .get("harness")
                .and_then(|value| value.get("sceneapp_id"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn build_sceneapp_run_summary_from_agent_run_inner(
    run: &AgentRun,
    descriptor: Option<&SceneAppDescriptor>,
    sceneapp_id: String,
    runtime_evidence: Option<&RuntimeEvidenceSceneAppSnapshot>,
) -> SceneAppRunSummary {
    let parsed = run
        .metadata
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
    let status = run_status_from_agent_run(&run.status);
    let metadata_artifact_paths = parsed
        .as_ref()
        .map(extract_artifact_paths_from_metadata_value)
        .unwrap_or_default();
    let metadata_artifact_count = metadata_artifact_paths
        .len()
        .max(parsed.as_ref().map(count_delivery_artifacts).unwrap_or(0));
    let artifact_paths = runtime_evidence
        .map(|snapshot| snapshot.recent_artifact_paths.clone())
        .unwrap_or_else(|| metadata_artifact_paths.clone());
    let artifact_count = runtime_evidence
        .map(|snapshot| snapshot.recent_artifact_paths.len())
        .unwrap_or(metadata_artifact_count);
    let (project_id, workspace_id) = parsed
        .as_ref()
        .map(extract_sceneapp_project_context_from_metadata_value)
        .unwrap_or((None, None));
    let delivery_artifact_refs = build_sceneapp_delivery_artifact_refs(
        descriptor,
        &artifact_paths,
        project_id.as_deref(),
        workspace_id.as_deref(),
        runtime_evidence.and_then(|snapshot| snapshot.workspace_root.as_deref()),
        if runtime_evidence.is_some() {
            "runtime_evidence"
        } else {
            "metadata_fallback"
        },
    );
    let governance_artifact_refs = build_sceneapp_governance_artifact_refs(
        run.session_id.as_deref(),
        project_id.as_deref(),
        workspace_id.as_deref(),
        runtime_evidence.and_then(|snapshot| snapshot.workspace_root.as_deref()),
    );
    let verification_failure_outcomes = runtime_evidence
        .map(|snapshot| snapshot.verification_failure_outcomes.clone())
        .unwrap_or_default();
    let runtime_evidence_used = runtime_evidence.is_some();
    let delivery_state = build_sceneapp_delivery_state(
        descriptor,
        &status,
        &artifact_paths,
        artifact_count,
        parsed
            .as_ref()
            .map(extract_delivery_success_from_metadata_value)
            .unwrap_or(false),
        runtime_evidence.is_some(),
        verification_failure_outcomes.as_slice(),
    );

    SceneAppRunSummary {
        run_id: run.id.clone(),
        sceneapp_id,
        status,
        source: run.source.clone(),
        source_ref: run.source_ref.clone(),
        session_id: run.session_id.clone(),
        browser_runtime_ref: parsed
            .as_ref()
            .and_then(extract_browser_runtime_ref_from_metadata_value),
        cloud_scene_runtime_ref: parsed
            .as_ref()
            .and_then(extract_cloud_scene_runtime_ref_from_metadata_value),
        native_skill_runtime_ref: parsed
            .as_ref()
            .and_then(extract_native_skill_runtime_ref_from_metadata_value),
        started_at: run.started_at.clone(),
        finished_at: run.finished_at.clone(),
        artifact_count,
        delivery_artifact_refs,
        governance_artifact_refs,
        delivery_required_parts: delivery_state.required_parts,
        delivery_completed_parts: delivery_state.completed_parts,
        delivery_missing_parts: delivery_state.missing_parts,
        delivery_completion_rate: delivery_state.completion_rate,
        delivery_part_coverage_known: delivery_state.part_coverage_known,
        failure_signal: delivery_state.failure_signal,
        runtime_evidence_used,
        evidence_known_gaps: runtime_evidence
            .map(|snapshot| snapshot.known_gaps.clone())
            .unwrap_or_default(),
        verification_failure_outcomes,
        request_telemetry_available: runtime_evidence
            .map(|snapshot| snapshot.request_telemetry_available),
        request_telemetry_matched_count: runtime_evidence
            .map(|snapshot| snapshot.request_telemetry_matched_count),
        artifact_validator_applicable: runtime_evidence
            .map(|snapshot| snapshot.artifact_validator_applicable),
        artifact_validator_issue_count: runtime_evidence
            .map(|snapshot| snapshot.artifact_validator_issue_count),
        artifact_validator_recovered_count: runtime_evidence
            .map(|snapshot| snapshot.artifact_validator_recovered_count),
    }
}

pub fn build_sceneapp_run_summary_from_agent_run(
    run: &AgentRun,
    descriptor: Option<&SceneAppDescriptor>,
    sceneapp_id: String,
) -> SceneAppRunSummary {
    build_sceneapp_run_summary_from_agent_run_inner(run, descriptor, sceneapp_id, None)
}

pub fn build_sceneapp_run_summary_from_agent_run_with_db(
    db: &DbConnection,
    run: &AgentRun,
    descriptor: Option<&SceneAppDescriptor>,
    sceneapp_id: String,
) -> SceneAppRunSummary {
    let runtime_evidence = load_sceneapp_run_runtime_evidence(db, run);
    build_sceneapp_run_summary_from_agent_run_inner(
        run,
        descriptor,
        sceneapp_id,
        runtime_evidence.as_ref(),
    )
}

pub fn build_sceneapp_run_summary_from_automation_job(
    job: &AutomationJobRecord,
    descriptor: Option<&SceneAppDescriptor>,
    sceneapp_id: String,
) -> SceneAppRunSummary {
    let status = run_status_from_job_status(job.last_status.as_deref());
    let artifact_count = job
        .last_delivery
        .as_ref()
        .filter(|delivery| delivery.success)
        .map(|_| 1usize)
        .unwrap_or(0);
    let delivery_state = build_sceneapp_delivery_state(
        descriptor,
        &status,
        &[],
        artifact_count,
        job.last_delivery
            .as_ref()
            .map(|delivery| delivery.success)
            .unwrap_or(false),
        false,
        &[],
    );

    SceneAppRunSummary {
        run_id: format!("automation-job:{}", job.id),
        sceneapp_id,
        status,
        source: "automation".to_string(),
        source_ref: Some(job.id.clone()),
        session_id: None,
        browser_runtime_ref: None,
        cloud_scene_runtime_ref: None,
        native_skill_runtime_ref: None,
        started_at: job
            .last_run_at
            .clone()
            .unwrap_or_else(|| job.created_at.clone()),
        finished_at: job.last_finished_at.clone(),
        artifact_count,
        delivery_artifact_refs: Vec::new(),
        governance_artifact_refs: Vec::new(),
        delivery_required_parts: delivery_state.required_parts,
        delivery_completed_parts: delivery_state.completed_parts,
        delivery_missing_parts: delivery_state.missing_parts,
        delivery_completion_rate: delivery_state.completion_rate,
        delivery_part_coverage_known: delivery_state.part_coverage_known,
        failure_signal: delivery_state.failure_signal,
        runtime_evidence_used: false,
        evidence_known_gaps: Vec::new(),
        verification_failure_outcomes: Vec::new(),
        request_telemetry_available: None,
        request_telemetry_matched_count: None,
        artifact_validator_applicable: None,
        artifact_validator_issue_count: None,
        artifact_validator_recovered_count: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::dao::agent_run::{AgentRun, AgentRunStatus};
    use crate::database::dao::automation_job::AutomationJob;
    use crate::database::dao::automation_job::AutomationJobLastDelivery;
    use crate::sceneapp::catalog::get_sceneapp_descriptor;
    use lime_core::config::{AutomationExecutionMode, DeliveryConfig, TaskSchedule};

    fn create_agent_run(metadata: Value) -> AgentRun {
        AgentRun {
            id: "run-1".to_string(),
            source: "chat".to_string(),
            source_ref: None,
            session_id: Some("session-1".to_string()),
            status: AgentRunStatus::Success,
            started_at: "2026-04-15T00:00:00.000Z".to_string(),
            finished_at: Some("2026-04-15T00:01:00.000Z".to_string()),
            duration_ms: Some(60_000),
            error_code: None,
            error_message: None,
            metadata: Some(metadata.to_string()),
            created_at: "2026-04-15T00:00:00.000Z".to_string(),
            updated_at: "2026-04-15T00:01:00.000Z".to_string(),
        }
    }

    fn create_automation_job(
        last_delivery: Option<AutomationJobLastDelivery>,
    ) -> AutomationJobRecord {
        AutomationJob {
            id: "job-1".to_string(),
            name: "SceneApp automation".to_string(),
            description: None,
            enabled: true,
            workspace_id: "workspace-1".to_string(),
            execution_mode: AutomationExecutionMode::Intelligent,
            schedule: TaskSchedule::Every { every_secs: 3600 },
            payload: json!({}),
            delivery: DeliveryConfig::default(),
            timeout_secs: None,
            max_retries: 1,
            next_run_at: None,
            last_status: Some("success".to_string()),
            last_error: None,
            last_run_at: Some("2026-04-15T00:00:00.000Z".to_string()),
            last_finished_at: Some("2026-04-15T00:03:00.000Z".to_string()),
            running_started_at: None,
            consecutive_failures: 0,
            last_retry_count: 0,
            auto_disabled_until: None,
            last_delivery,
            created_at: "2026-04-15T00:00:00.000Z".to_string(),
            updated_at: "2026-04-15T00:03:00.000Z".to_string(),
        }
    }

    fn create_runtime_evidence(
        artifact_paths: &[&str],
        verification_failure_outcomes: &[&str],
    ) -> RuntimeEvidenceSceneAppSnapshot {
        RuntimeEvidenceSceneAppSnapshot {
            recent_artifact_paths: artifact_paths.iter().map(|path| path.to_string()).collect(),
            workspace_root: Some("/tmp/workspace".to_string()),
            known_gaps: Vec::new(),
            verification_failure_outcomes: verification_failure_outcomes
                .iter()
                .map(|item| item.to_string())
                .collect(),
            request_telemetry_available: false,
            request_telemetry_matched_count: 0,
            artifact_validator_applicable: false,
            artifact_validator_issue_count: 0,
            artifact_validator_recovered_count: 0,
        }
    }

    #[test]
    fn build_sceneapp_run_summary_from_agent_run_should_extract_delivery_parts() {
        let descriptor =
            get_sceneapp_descriptor("story-video-suite").expect("descriptor should exist");
        let run = create_agent_run(json!({
            "sceneapp": { "id": "story-video-suite" },
            "artifact_paths": [
                "artifacts/brief.md",
                "artifacts/storyboard.json",
                "artifacts/video_draft.mp4"
            ],
        }));

        let summary = build_sceneapp_run_summary_from_agent_run(
            &run,
            Some(&descriptor),
            "story-video-suite".to_string(),
        );

        assert_eq!(summary.artifact_count, 3);
        assert_eq!(
            summary.delivery_artifact_refs,
            vec![
                SceneAppDeliveryArtifactRef {
                    relative_path: "artifacts/brief.md".to_string(),
                    absolute_path: None,
                    part_key: Some("brief".to_string()),
                    project_id: None,
                    workspace_id: None,
                    source: "metadata_fallback".to_string(),
                },
                SceneAppDeliveryArtifactRef {
                    relative_path: "artifacts/storyboard.json".to_string(),
                    absolute_path: None,
                    part_key: Some("storyboard".to_string()),
                    project_id: None,
                    workspace_id: None,
                    source: "metadata_fallback".to_string(),
                },
                SceneAppDeliveryArtifactRef {
                    relative_path: "artifacts/video_draft.mp4".to_string(),
                    absolute_path: None,
                    part_key: Some("video_draft".to_string()),
                    project_id: None,
                    workspace_id: None,
                    source: "metadata_fallback".to_string(),
                },
            ]
        );
        assert_eq!(summary.source_ref, None);
        assert_eq!(summary.session_id.as_deref(), Some("session-1"));
        assert_eq!(
            summary.governance_artifact_refs,
            vec![
                SceneAppGovernanceArtifactRef {
                    kind: SceneAppGovernanceArtifactKind::EvidenceSummary,
                    label: "证据摘要".to_string(),
                    relative_path: ".lime/harness/sessions/session-1/evidence/summary.md"
                        .to_string(),
                    absolute_path: None,
                    project_id: None,
                    workspace_id: None,
                    source: "session_governance".to_string(),
                },
                SceneAppGovernanceArtifactRef {
                    kind: SceneAppGovernanceArtifactKind::ReviewDecisionMarkdown,
                    label: "人工复核记录".to_string(),
                    relative_path: ".lime/harness/sessions/session-1/review/review-decision.md"
                        .to_string(),
                    absolute_path: None,
                    project_id: None,
                    workspace_id: None,
                    source: "session_governance".to_string(),
                },
                SceneAppGovernanceArtifactRef {
                    kind: SceneAppGovernanceArtifactKind::ReviewDecisionJson,
                    label: "复核 JSON".to_string(),
                    relative_path: ".lime/harness/sessions/session-1/review/review-decision.json"
                        .to_string(),
                    absolute_path: None,
                    project_id: None,
                    workspace_id: None,
                    source: "session_governance".to_string(),
                },
            ]
        );
        assert_eq!(summary.browser_runtime_ref, None);
        assert_eq!(summary.cloud_scene_runtime_ref, None);
        assert_eq!(summary.native_skill_runtime_ref, None);
        assert_eq!(
            summary.delivery_completed_parts,
            vec![
                "brief".to_string(),
                "storyboard".to_string(),
                "video_draft".to_string(),
            ]
        );
        assert_eq!(
            summary.delivery_missing_parts,
            vec![
                "script".to_string(),
                "music_refs".to_string(),
                "review_note".to_string(),
            ]
        );
        assert_eq!(summary.delivery_completion_rate, Some(50.0));
        assert!(summary.delivery_part_coverage_known);
        assert_eq!(summary.failure_signal.as_deref(), Some("review_blocked"));
    }

    #[test]
    fn build_sceneapp_run_summary_from_agent_run_should_extract_browser_runtime_ref() {
        let run = create_agent_run(json!({
            "sceneapp": { "id": "x-article-export" },
            "browser_runtime_ref": {
                "session_id": "browser-session-1",
                "target_id": "target-1"
            },
            "request_metadata": {
                "browser_assist": {
                    "profile_key": "general_browser_assist"
                }
            }
        }));

        let summary =
            build_sceneapp_run_summary_from_agent_run(&run, None, "x-article-export".to_string());

        assert_eq!(
            summary.browser_runtime_ref,
            Some(SceneAppBrowserRuntimeRef {
                profile_key: Some("general_browser_assist".to_string()),
                session_id: Some("browser-session-1".to_string()),
                target_id: Some("target-1".to_string()),
            })
        );
        assert_eq!(summary.cloud_scene_runtime_ref, None);
        assert_eq!(summary.native_skill_runtime_ref, None);
    }

    #[test]
    fn build_sceneapp_run_summary_from_agent_run_should_extract_cloud_scene_runtime_ref() {
        let run = create_agent_run(json!({
            "sceneapp": { "id": "story-video-suite" },
            "request_metadata": {
                "harness": {
                    "service_scene_launch": {
                        "kind": "cloud_scene",
                        "service_scene_run": {
                            "scene_key": "story-video-suite",
                            "skill_id": "sceneapp-service-story-video",
                            "project_id": "project-video",
                            "content_id": "content-video-1",
                            "workspace_id": "workspace-video",
                            "entry_source": "sceneapp_plan",
                            "user_input": "生成一版产品短视频",
                            "slots": {
                                "duration": "30 秒"
                            }
                        }
                    }
                }
            }
        }));

        let summary =
            build_sceneapp_run_summary_from_agent_run(&run, None, "story-video-suite".to_string());

        assert_eq!(
            summary.cloud_scene_runtime_ref,
            Some(SceneAppCloudSceneRuntimeRef {
                scene_key: Some("story-video-suite".to_string()),
                skill_id: Some("sceneapp-service-story-video".to_string()),
                project_id: Some("project-video".to_string()),
                content_id: Some("content-video-1".to_string()),
                workspace_id: Some("workspace-video".to_string()),
                entry_source: Some("sceneapp_plan".to_string()),
                user_input: Some("生成一版产品短视频".to_string()),
                slots: BTreeMap::from([("duration".to_string(), "30 秒".to_string())]),
            })
        );
        assert_eq!(summary.native_skill_runtime_ref, None);
    }

    #[test]
    fn build_sceneapp_run_summary_from_agent_run_should_extract_native_skill_runtime_ref() {
        let run = create_agent_run(json!({
            "sceneapp": { "id": "project-analysis-copilot" },
            "request_metadata": {
                "harness": {
                    "sceneapp_native_skill_launch": {
                        "skill_id": "sceneapp-service-analysis",
                        "skill_key": "project-analysis",
                        "project_id": "project-analysis",
                        "workspace_id": "workspace-analysis",
                        "user_input": "请分析当前项目结构",
                        "slots": {
                            "focus": "架构",
                            "depth": "高"
                        }
                    }
                }
            }
        }));

        let summary = build_sceneapp_run_summary_from_agent_run(
            &run,
            None,
            "project-analysis-copilot".to_string(),
        );

        assert_eq!(
            summary.native_skill_runtime_ref,
            Some(SceneAppNativeSkillRuntimeRef {
                skill_id: Some("sceneapp-service-analysis".to_string()),
                skill_key: Some("project-analysis".to_string()),
                project_id: Some("project-analysis".to_string()),
                workspace_id: Some("workspace-analysis".to_string()),
                user_input: Some("请分析当前项目结构".to_string()),
                slots: BTreeMap::from([
                    ("depth".to_string(), "高".to_string()),
                    ("focus".to_string(), "架构".to_string()),
                ]),
            })
        );
    }

    #[test]
    fn build_sceneapp_run_summary_should_prefer_runtime_evidence_artifacts() {
        let descriptor =
            get_sceneapp_descriptor("story-video-suite").expect("descriptor should exist");
        let run = create_agent_run(json!({
            "sceneapp": { "id": "story-video-suite" },
            "artifact_paths": ["artifacts/brief.md"],
        }));
        let runtime_evidence = create_runtime_evidence(
            &[
                "artifacts/brief.md",
                "artifacts/storyboard.json",
                "artifacts/script.md",
                "artifacts/music_refs.md",
                "artifacts/video_draft.mp4",
                "artifacts/review_note.md",
            ],
            &[],
        );

        let summary = build_sceneapp_run_summary_from_agent_run_inner(
            &run,
            Some(&descriptor),
            "story-video-suite".to_string(),
            Some(&runtime_evidence),
        );

        assert_eq!(summary.artifact_count, 6);
        assert_eq!(
            summary.delivery_completed_parts,
            vec![
                "brief".to_string(),
                "storyboard".to_string(),
                "script".to_string(),
                "music_refs".to_string(),
                "video_draft".to_string(),
                "review_note".to_string(),
            ]
        );
        assert!(summary.delivery_missing_parts.is_empty());
        assert_eq!(summary.delivery_completion_rate, Some(100.0));
        assert!(summary.delivery_part_coverage_known);
        assert_eq!(summary.failure_signal, None);
        assert!(summary.runtime_evidence_used);
        assert_eq!(
            summary.delivery_artifact_refs,
            vec![
                SceneAppDeliveryArtifactRef {
                    relative_path: "artifacts/brief.md".to_string(),
                    absolute_path: Some("/tmp/workspace/artifacts/brief.md".to_string()),
                    part_key: Some("brief".to_string()),
                    project_id: None,
                    workspace_id: None,
                    source: "runtime_evidence".to_string(),
                },
                SceneAppDeliveryArtifactRef {
                    relative_path: "artifacts/storyboard.json".to_string(),
                    absolute_path: Some("/tmp/workspace/artifacts/storyboard.json".to_string()),
                    part_key: Some("storyboard".to_string()),
                    project_id: None,
                    workspace_id: None,
                    source: "runtime_evidence".to_string(),
                },
                SceneAppDeliveryArtifactRef {
                    relative_path: "artifacts/script.md".to_string(),
                    absolute_path: Some("/tmp/workspace/artifacts/script.md".to_string()),
                    part_key: Some("script".to_string()),
                    project_id: None,
                    workspace_id: None,
                    source: "runtime_evidence".to_string(),
                },
                SceneAppDeliveryArtifactRef {
                    relative_path: "artifacts/music_refs.md".to_string(),
                    absolute_path: Some("/tmp/workspace/artifacts/music_refs.md".to_string()),
                    part_key: Some("music_refs".to_string()),
                    project_id: None,
                    workspace_id: None,
                    source: "runtime_evidence".to_string(),
                },
                SceneAppDeliveryArtifactRef {
                    relative_path: "artifacts/video_draft.mp4".to_string(),
                    absolute_path: Some("/tmp/workspace/artifacts/video_draft.mp4".to_string()),
                    part_key: Some("video_draft".to_string()),
                    project_id: None,
                    workspace_id: None,
                    source: "runtime_evidence".to_string(),
                },
                SceneAppDeliveryArtifactRef {
                    relative_path: "artifacts/review_note.md".to_string(),
                    absolute_path: Some("/tmp/workspace/artifacts/review_note.md".to_string()),
                    part_key: Some("review_note".to_string()),
                    project_id: None,
                    workspace_id: None,
                    source: "runtime_evidence".to_string(),
                },
            ]
        );
        assert_eq!(
            summary.governance_artifact_refs,
            vec![
                SceneAppGovernanceArtifactRef {
                    kind: SceneAppGovernanceArtifactKind::EvidenceSummary,
                    label: "证据摘要".to_string(),
                    relative_path: ".lime/harness/sessions/session-1/evidence/summary.md"
                        .to_string(),
                    absolute_path: Some(
                        "/tmp/workspace/.lime/harness/sessions/session-1/evidence/summary.md"
                            .to_string()
                    ),
                    project_id: None,
                    workspace_id: None,
                    source: "session_governance".to_string(),
                },
                SceneAppGovernanceArtifactRef {
                    kind: SceneAppGovernanceArtifactKind::ReviewDecisionMarkdown,
                    label: "人工复核记录".to_string(),
                    relative_path:
                        ".lime/harness/sessions/session-1/review/review-decision.md"
                            .to_string(),
                    absolute_path: Some(
                        "/tmp/workspace/.lime/harness/sessions/session-1/review/review-decision.md"
                            .to_string()
                    ),
                    project_id: None,
                    workspace_id: None,
                    source: "session_governance".to_string(),
                },
                SceneAppGovernanceArtifactRef {
                    kind: SceneAppGovernanceArtifactKind::ReviewDecisionJson,
                    label: "复核 JSON".to_string(),
                    relative_path:
                        ".lime/harness/sessions/session-1/review/review-decision.json"
                            .to_string(),
                    absolute_path: Some(
                        "/tmp/workspace/.lime/harness/sessions/session-1/review/review-decision.json"
                            .to_string()
                    ),
                    project_id: None,
                    workspace_id: None,
                    source: "session_governance".to_string(),
                },
            ]
        );
        assert_eq!(summary.request_telemetry_available, Some(false));
        assert_eq!(summary.request_telemetry_matched_count, Some(0));
    }

    #[test]
    fn build_sceneapp_run_summary_should_mark_review_blocked_on_runtime_verification_failure() {
        let descriptor =
            get_sceneapp_descriptor("story-video-suite").expect("descriptor should exist");
        let run = create_agent_run(json!({
            "sceneapp": { "id": "story-video-suite" },
        }));
        let runtime_evidence = create_runtime_evidence(
            &[
                "artifacts/brief.md",
                "artifacts/storyboard.json",
                "artifacts/script.md",
                "artifacts/music_refs.md",
                "artifacts/video_draft.mp4",
                "artifacts/review_note.md",
            ],
            &["Artifact 校验存在 1 条未恢复 issues。"],
        );

        let summary = build_sceneapp_run_summary_from_agent_run_inner(
            &run,
            Some(&descriptor),
            "story-video-suite".to_string(),
            Some(&runtime_evidence),
        );

        assert_eq!(summary.delivery_completion_rate, Some(100.0));
        assert_eq!(summary.failure_signal.as_deref(), Some("review_blocked"));
        assert_eq!(
            summary.verification_failure_outcomes,
            vec!["Artifact 校验存在 1 条未恢复 issues。".to_string()]
        );
    }

    #[test]
    fn build_sceneapp_run_summary_from_automation_job_should_reflect_delivery_artifact() {
        let descriptor =
            get_sceneapp_descriptor("daily-trend-briefing").expect("descriptor should exist");
        let summary = build_sceneapp_run_summary_from_automation_job(
            &create_automation_job(Some(AutomationJobLastDelivery {
                success: true,
                message: "ok".to_string(),
                channel: None,
                target: None,
                output_kind: "document".to_string(),
                output_schema: "markdown".to_string(),
                output_format: "md".to_string(),
                output_preview: "preview".to_string(),
                delivery_attempt_id: None,
                run_id: None,
                execution_retry_count: 0,
                delivery_attempts: 1,
                attempted_at: "2026-04-15T00:03:00.000Z".to_string(),
            })),
            Some(&descriptor),
            "daily-trend-briefing".to_string(),
        );

        assert_eq!(summary.artifact_count, 1);
        assert_eq!(summary.source_ref.as_deref(), Some("job-1"));
        assert_eq!(summary.session_id, None);
        assert_eq!(summary.browser_runtime_ref, None);
        assert_eq!(summary.cloud_scene_runtime_ref, None);
        assert_eq!(summary.native_skill_runtime_ref, None);
        assert_eq!(
            summary.delivery_required_parts,
            vec!["brief".to_string(), "review_note".to_string()]
        );
        assert!(!summary.delivery_part_coverage_known);
    }
}
