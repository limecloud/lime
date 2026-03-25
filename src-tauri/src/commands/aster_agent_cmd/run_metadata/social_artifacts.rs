use super::*;
use lime_agent::artifact_protocol::{
    extract_artifact_protocol_paths_from_metadata, extract_artifact_protocol_paths_from_value,
    normalize_artifact_protocol_path,
};
use lime_agent::filesystem_event_protocol::extract_filesystem_event_location_hints_from_metadata;
use lime_agent::AgentEvent as RuntimeAgentEvent;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(in crate::commands::aster_agent_cmd) struct SocialRunArtifactDescriptor {
    pub(in crate::commands::aster_agent_cmd) artifact_id: String,
    pub(in crate::commands::aster_agent_cmd) artifact_type: String,
    pub(in crate::commands::aster_agent_cmd) stage: String,
    pub(in crate::commands::aster_agent_cmd) stage_label: String,
    pub(in crate::commands::aster_agent_cmd) version_label: String,
    pub(in crate::commands::aster_agent_cmd) source_file_name: String,
    pub(in crate::commands::aster_agent_cmd) branch_key: String,
    pub(in crate::commands::aster_agent_cmd) platform: Option<String>,
    pub(in crate::commands::aster_agent_cmd) is_auxiliary: bool,
}

#[derive(Debug, Clone, Default)]
pub(in crate::commands::aster_agent_cmd) struct ChatRunObservation {
    pub(in crate::commands::aster_agent_cmd) artifact_paths: Vec<String>,
    pub(in crate::commands::aster_agent_cmd) primary_social_artifact:
        Option<SocialRunArtifactDescriptor>,
    pub(in crate::commands::aster_agent_cmd) provider_continuation:
        Option<ProviderContinuationState>,
}

impl ChatRunObservation {
    pub(in crate::commands::aster_agent_cmd) fn record_event(
        &mut self,
        event: &RuntimeAgentEvent,
        workspace_root: &str,
        request_metadata: Option<&serde_json::Value>,
        provider_continuation_capability: ProviderContinuationCapability,
    ) {
        match event {
            RuntimeAgentEvent::ToolStart {
                tool_name,
                arguments,
                ..
            } => {
                if let Some(path) = extract_artifact_path_from_tool_start(
                    tool_name,
                    arguments.as_deref(),
                    workspace_root,
                ) {
                    self.record_artifact_path(path, request_metadata);
                }
            }
            RuntimeAgentEvent::ToolEnd { result, .. } => {
                if let Some(metadata) = &result.metadata {
                    if let Some(provider_continuation) = extract_provider_continuation_from_metadata(
                        metadata,
                        provider_continuation_capability,
                    ) {
                        self.record_provider_continuation(provider_continuation);
                    }
                    for path in
                        extract_artifact_paths_from_tool_result_metadata(metadata, workspace_root)
                    {
                        self.record_artifact_path(path, request_metadata);
                    }
                }
            }
            RuntimeAgentEvent::Message { message } => {
                if let Some(provider_continuation) = extract_provider_continuation_from_message(
                    message,
                    provider_continuation_capability,
                ) {
                    self.record_provider_continuation(provider_continuation);
                }
            }
            RuntimeAgentEvent::ArtifactSnapshot { artifact } => {
                if let Some(path) =
                    normalize_metadata_path(artifact.file_path.as_str(), workspace_root)
                {
                    self.record_artifact_path(path, request_metadata);
                }
            }
            _ => {}
        }
    }

    fn record_provider_continuation(&mut self, provider_continuation: ProviderContinuationState) {
        if matches!(
            provider_continuation,
            ProviderContinuationState::HistoryReplayOnly
        ) {
            return;
        }
        self.provider_continuation = Some(provider_continuation);
    }

    pub(in crate::commands::aster_agent_cmd) fn record_artifact_path(
        &mut self,
        path: String,
        request_metadata: Option<&serde_json::Value>,
    ) {
        if path.trim().is_empty() {
            return;
        }

        if !self.artifact_paths.iter().any(|item| item == &path) {
            self.artifact_paths.push(path.clone());
        }

        if !should_track_social_artifact(request_metadata, path.as_str()) {
            return;
        }

        let gate_key = extract_harness_string(request_metadata, &["gate_key", "gateKey"]);
        let run_title =
            extract_harness_string(request_metadata, &["run_title", "runTitle", "title"]);
        let candidate = resolve_social_run_artifact_descriptor(
            path.as_str(),
            gate_key.as_deref(),
            run_title.as_deref(),
        );
        let should_replace = match self.primary_social_artifact.as_ref() {
            None => true,
            Some(existing) if existing.is_auxiliary && !candidate.is_auxiliary => true,
            _ => false,
        };
        if should_replace {
            self.primary_social_artifact = Some(candidate);
        }
    }
}

fn normalize_metadata_path(raw: &str, workspace_root: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.replace('\\', "/");
    let normalized_root = workspace_root.trim().replace('\\', "/");

    if !normalized_root.is_empty() && normalized.starts_with(normalized_root.as_str()) {
        let suffix = normalized
            .strip_prefix(normalized_root.as_str())
            .unwrap_or(normalized.as_str())
            .trim_start_matches('/')
            .to_string();
        if !suffix.is_empty() {
            return Some(suffix);
        }
    }

    Some(normalized)
}

fn parse_tool_arguments(arguments: Option<&str>) -> Option<serde_json::Value> {
    let raw = arguments?.trim();
    if raw.is_empty() {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(raw).ok()
}

pub(in crate::commands::aster_agent_cmd) fn extract_artifact_path_from_tool_start(
    tool_name: &str,
    arguments: Option<&str>,
    workspace_root: &str,
) -> Option<String> {
    let normalized_tool_name = tool_name.trim().to_lowercase();
    if normalized_tool_name.is_empty() {
        return None;
    }

    let args = parse_tool_arguments(arguments)?;
    if normalized_tool_name.contains("write")
        || normalized_tool_name.contains("create")
        || normalized_tool_name.contains("output")
    {
        return extract_artifact_protocol_paths_from_value(&args)
            .into_iter()
            .find_map(|path| normalize_metadata_path(path.as_str(), workspace_root));
    }

    None
}

fn push_normalized_metadata_path(target: &mut Vec<String>, path: &str, workspace_root: &str) {
    if let Some(normalized) = normalize_metadata_path(path, workspace_root) {
        if !target.iter().any(|item| item == &normalized) {
            target.push(normalized);
        }
    }
}

fn push_compat_metadata_paths(
    target: &mut Vec<String>,
    value: &serde_json::Value,
    workspace_root: &str,
) {
    match value {
        serde_json::Value::String(path) => {
            let Some(normalized_path) = normalize_artifact_protocol_path(path) else {
                return;
            };
            push_normalized_metadata_path(target, normalized_path.as_str(), workspace_root);
        }
        serde_json::Value::Array(items) => {
            for item in items {
                push_compat_metadata_paths(target, item, workspace_root);
            }
        }
        _ => {}
    }
}

fn is_probable_artifact_location_hint(path: &str) -> bool {
    let normalized = path.trim().replace('\\', "/").to_lowercase();
    if normalized.is_empty() || normalized.ends_with('/') {
        return false;
    }

    let file_name = normalized.rsplit('/').next().unwrap_or(normalized.as_str());
    if !file_name.contains('.') {
        return false;
    }

    !file_name.ends_with(".log") && !file_name.ends_with(".txt") && !file_name.ends_with(".jsonl")
}

fn extract_artifact_paths_from_tool_result_metadata(
    metadata: &HashMap<String, serde_json::Value>,
    workspace_root: &str,
) -> Vec<String> {
    let mut paths = extract_artifact_protocol_paths_from_metadata(metadata)
        .into_iter()
        .filter_map(|path| normalize_metadata_path(path.as_str(), workspace_root))
        .collect::<Vec<_>>();

    for key in ["article_path", "cover_meta_path", "publish_path"] {
        if let Some(value) = metadata.get(key) {
            push_compat_metadata_paths(&mut paths, value, workspace_root);
        }
    }

    if paths.is_empty() {
        // `output_file` / `cwd` 这类字段只是文件事件位置线索，不是 artifact 事实源。
        // 只有完全没有显式 artifact 路径时，才允许做一次保守兜底。
        for hint in extract_filesystem_event_location_hints_from_metadata(metadata) {
            if is_probable_artifact_location_hint(hint.as_str()) {
                push_normalized_metadata_path(&mut paths, hint.as_str(), workspace_root);
            }
        }
    }

    paths
}

fn should_track_social_artifact(request_metadata: Option<&serde_json::Value>, path: &str) -> bool {
    if extract_harness_string(request_metadata, &["theme", "harness_theme"])
        .map(|theme| theme == "social-media")
        .unwrap_or(false)
    {
        return true;
    }
    path.to_lowercase().contains("social")
}

fn normalize_artifact_file_name(file_name: &str) -> String {
    file_name.replace('\\', "/").trim().to_string()
}

fn artifact_base_name(file_name: &str) -> String {
    normalize_artifact_file_name(file_name)
        .split('/')
        .last()
        .unwrap_or(file_name)
        .to_string()
}

fn strip_social_known_suffix(file_name: &str) -> String {
    let base_name = artifact_base_name(file_name);
    if let Some(value) = base_name.strip_suffix(".publish-pack.json") {
        return value.to_string();
    }
    if let Some(value) = base_name.strip_suffix(".cover.json") {
        return value.to_string();
    }
    base_name
        .rsplit_once('.')
        .map(|(prefix, _)| prefix.to_string())
        .unwrap_or(base_name)
}

fn to_social_branch_key(file_name: &str) -> String {
    let mut branch_key = String::new();
    let mut last_is_dash = false;
    for ch in strip_social_known_suffix(file_name).chars() {
        let keep = ch.is_ascii_alphanumeric() || ('\u{4e00}'..='\u{9fa5}').contains(&ch);
        if keep {
            branch_key.push(ch.to_ascii_lowercase());
            last_is_dash = false;
        } else if !last_is_dash {
            branch_key.push('-');
            last_is_dash = true;
        }
    }
    let branch_key = branch_key.trim_matches('-').to_string();
    if branch_key.is_empty() {
        "artifact".to_string()
    } else {
        branch_key
    }
}

fn infer_social_platform_from_text(text: &str) -> Option<String> {
    let normalized = text.to_lowercase();
    if normalized.contains("xiaohongshu") || normalized.contains("xhs") || text.contains("小红书")
    {
        return Some("xiaohongshu".to_string());
    }
    if normalized.contains("wechat")
        || normalized.contains("weixin")
        || normalized.contains("gzh")
        || text.contains("公众号")
        || text.contains("微信")
    {
        return Some("wechat".to_string());
    }
    if normalized.contains("zhihu") || text.contains("知乎") {
        return Some("zhihu".to_string());
    }
    None
}

fn resolve_social_artifact_type(
    normalized_file_name: &str,
    platform: Option<&str>,
    gate_key: Option<&str>,
) -> String {
    let base_name = artifact_base_name(normalized_file_name).to_lowercase();
    if base_name.ends_with(".publish-pack.json") {
        return "publish_package".to_string();
    }
    if base_name.ends_with(".cover.json") {
        return "cover_meta".to_string();
    }
    if !base_name.ends_with(".md") {
        return "asset".to_string();
    }
    if base_name == "brief.md" || base_name.contains("brief") {
        return "brief".to_string();
    }
    if base_name == "draft.md" || base_name.contains("draft") {
        return "draft".to_string();
    }
    if base_name == "article.md" || base_name.contains("article") || base_name.contains("final") {
        return "polished".to_string();
    }
    if base_name == "adapted.md" || base_name.contains("adapt") {
        return "platform_variant".to_string();
    }
    if platform.is_some() {
        return "platform_variant".to_string();
    }
    match gate_key.unwrap_or_default() {
        "topic_select" => "brief".to_string(),
        "publish_confirm" => {
            if platform.is_some() {
                "platform_variant".to_string()
            } else {
                "polished".to_string()
            }
        }
        _ => "draft".to_string(),
    }
}

fn resolve_social_stage_for_artifact(artifact_type: &str, gate_key: Option<&str>) -> String {
    match artifact_type {
        "brief" => "briefing".to_string(),
        "draft" => "drafting".to_string(),
        "polished" => "polishing".to_string(),
        "platform_variant" => "adapting".to_string(),
        "cover_meta" | "publish_package" => "publish_prep".to_string(),
        _ => match gate_key.unwrap_or("idle") {
            "topic_select" => "briefing".to_string(),
            "publish_confirm" => "publish_prep".to_string(),
            _ => "drafting".to_string(),
        },
    }
}

fn resolve_social_stage_label(stage: &str) -> String {
    match stage {
        "briefing" => "需求澄清".to_string(),
        "drafting" => "初稿创作".to_string(),
        "polishing" => "润色优化".to_string(),
        "adapting" => "平台适配".to_string(),
        "publish_prep" => "发布准备".to_string(),
        _ => "社媒创作".to_string(),
    }
}

fn resolve_social_version_label(artifact_type: &str, platform: Option<&str>) -> String {
    match artifact_type {
        "brief" => "需求简报".to_string(),
        "draft" => "社媒初稿".to_string(),
        "polished" => "润色成稿".to_string(),
        "platform_variant" => match platform {
            Some("xiaohongshu") => "平台适配 · 小红书".to_string(),
            Some("wechat") => "平台适配 · 公众号".to_string(),
            Some("zhihu") => "平台适配 · 知乎".to_string(),
            _ => "平台适配".to_string(),
        },
        "cover_meta" => "封面配置".to_string(),
        "publish_package" => "发布包".to_string(),
        _ => "社媒产物".to_string(),
    }
}

pub(in crate::commands::aster_agent_cmd) fn resolve_social_run_artifact_descriptor(
    file_name: &str,
    gate_key: Option<&str>,
    run_title: Option<&str>,
) -> SocialRunArtifactDescriptor {
    let normalized_file_name = normalize_artifact_file_name(file_name);
    let platform = infer_social_platform_from_text(
        format!("{} {}", normalized_file_name, run_title.unwrap_or_default()).as_str(),
    );
    let artifact_type =
        resolve_social_artifact_type(normalized_file_name.as_str(), platform.as_deref(), gate_key);
    let stage = resolve_social_stage_for_artifact(artifact_type.as_str(), gate_key);
    let branch_key = to_social_branch_key(normalized_file_name.as_str());
    let artifact_suffix = match platform.as_deref() {
        Some(platform) => format!("{branch_key}:{platform}"),
        None => branch_key.clone(),
    };

    SocialRunArtifactDescriptor {
        artifact_id: format!("social-media:{}:{}", artifact_type, artifact_suffix),
        artifact_type: artifact_type.clone(),
        stage: stage.clone(),
        stage_label: resolve_social_stage_label(stage.as_str()),
        version_label: resolve_social_version_label(artifact_type.as_str(), platform.as_deref()),
        source_file_name: normalized_file_name,
        branch_key,
        platform,
        is_auxiliary: matches!(
            artifact_type.as_str(),
            "cover_meta" | "publish_package" | "asset"
        ),
    }
}

fn infer_gate_key_from_social_stage(stage: &str) -> Option<&'static str> {
    match stage {
        "briefing" => Some("topic_select"),
        "drafting" | "polishing" => Some("write_mode"),
        "adapting" | "publish_prep" => Some("publish_confirm"),
        _ => None,
    }
}

pub(in crate::commands::aster_agent_cmd) fn build_chat_run_finish_metadata(
    base_metadata: &serde_json::Map<String, serde_json::Value>,
    observation: &ChatRunObservation,
) -> serde_json::Value {
    let mut metadata = base_metadata.clone();

    if !observation.artifact_paths.is_empty() {
        metadata.insert(
            "artifact_paths".to_string(),
            serde_json::json!(observation.artifact_paths.clone()),
        );
    }

    if let Some(artifact) = observation.primary_social_artifact.as_ref() {
        with_string_field(&mut metadata, "harness_theme", Some("social-media"));
        with_string_field(
            &mut metadata,
            "artifact_id",
            Some(artifact.artifact_id.as_str()),
        );
        with_string_field(
            &mut metadata,
            "artifact_type",
            Some(artifact.artifact_type.as_str()),
        );
        with_string_field(&mut metadata, "stage", Some(artifact.stage.as_str()));
        with_string_field(
            &mut metadata,
            "stage_label",
            Some(artifact.stage_label.as_str()),
        );
        with_string_field(
            &mut metadata,
            "version_label",
            Some(artifact.version_label.as_str()),
        );
        with_string_field(
            &mut metadata,
            "branch_key",
            Some(artifact.branch_key.as_str()),
        );
        with_string_field(&mut metadata, "platform", artifact.platform.as_deref());
        with_string_field(
            &mut metadata,
            "source_file_name",
            Some(artifact.source_file_name.as_str()),
        );
        let version_id = format!("artifact:{}", artifact.source_file_name);
        with_string_field(&mut metadata, "version_id", Some(version_id.as_str()));

        if !metadata.contains_key("gate_key") {
            with_string_field(
                &mut metadata,
                "gate_key",
                infer_gate_key_from_social_stage(artifact.stage.as_str()),
            );
        }
        if !metadata.contains_key("run_title") {
            with_string_field(
                &mut metadata,
                "run_title",
                Some(artifact.version_label.as_str()),
            );
        }
    }

    if let Some(provider_continuation) = observation.provider_continuation.as_ref() {
        if let Ok(provider_continuation_value) = serde_json::to_value(provider_continuation) {
            metadata.insert(
                "provider_continuation".to_string(),
                provider_continuation_value,
            );
        }
        metadata.insert(
            "provider_continuation_observed".to_string(),
            serde_json::json!(true),
        );
        with_string_field(
            &mut metadata,
            "provider_continuation_kind",
            Some(provider_continuation.kind()),
        );
    }

    serde_json::Value::Object(metadata)
}
