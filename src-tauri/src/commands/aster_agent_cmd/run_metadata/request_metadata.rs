use super::*;

fn extract_harness_object(
    request_metadata: Option<&serde_json::Value>,
) -> Option<&serde_json::Map<String, serde_json::Value>> {
    let metadata = request_metadata?;
    let object = metadata.as_object()?;
    if let Some(harness) = object.get("harness").and_then(serde_json::Value::as_object) {
        return Some(harness);
    }
    Some(object)
}

pub(in crate::commands::aster_agent_cmd) fn extract_harness_string(
    request_metadata: Option<&serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    let harness = extract_harness_object(request_metadata)?;
    keys.iter()
        .filter_map(|key| harness.get(*key))
        .find_map(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(in crate::commands::aster_agent_cmd) fn extract_harness_bool(
    request_metadata: Option<&serde_json::Value>,
    keys: &[&str],
) -> Option<bool> {
    let harness = extract_harness_object(request_metadata)?;
    keys.iter()
        .filter_map(|key| harness.get(*key))
        .find_map(serde_json::Value::as_bool)
}

pub(in crate::commands::aster_agent_cmd) fn extract_harness_array<'a>(
    request_metadata: Option<&'a serde_json::Value>,
    keys: &[&str],
) -> Option<&'a Vec<serde_json::Value>> {
    let harness = extract_harness_object(request_metadata)?;
    keys.iter()
        .filter_map(|key| harness.get(*key))
        .find_map(serde_json::Value::as_array)
}

pub(in crate::commands::aster_agent_cmd) fn extract_harness_nested_object<'a>(
    request_metadata: Option<&'a serde_json::Value>,
    keys: &[&str],
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    let harness = extract_harness_object(request_metadata)?;
    keys.iter()
        .filter_map(|key| harness.get(*key))
        .find_map(serde_json::Value::as_object)
}

pub(in crate::commands::aster_agent_cmd) fn extend_map_with_harness_fields(
    target: &mut serde_json::Map<String, serde_json::Value>,
    request_metadata: Option<&serde_json::Value>,
) {
    if let Some(metadata) = request_metadata {
        target.insert("request_metadata".to_string(), metadata.clone());
    }

    let Some(harness) = extract_harness_object(request_metadata) else {
        return;
    };

    for (source_key, target_key) in [
        ("theme", "harness_theme"),
        ("harness_theme", "harness_theme"),
        ("creation_mode", "creation_mode"),
        ("creationMode", "creation_mode"),
        ("chat_mode", "chat_mode"),
        ("chatMode", "chat_mode"),
        ("session_mode", "session_mode"),
        ("sessionMode", "session_mode"),
        ("gate_key", "gate_key"),
        ("gateKey", "gate_key"),
        ("run_title", "run_title"),
        ("runTitle", "run_title"),
        ("content_id", "content_id"),
        ("contentId", "content_id"),
        ("preferred_team_preset_id", "preferred_team_preset_id"),
        ("preferredTeamPresetId", "preferred_team_preset_id"),
        ("selected_team_id", "selected_team_id"),
        ("selectedTeamId", "selected_team_id"),
        ("selected_team_source", "selected_team_source"),
        ("selectedTeamSource", "selected_team_source"),
        ("selected_team_label", "selected_team_label"),
        ("selectedTeamLabel", "selected_team_label"),
        ("selected_team_summary", "selected_team_summary"),
        ("selectedTeamSummary", "selected_team_summary"),
        ("selected_team_roles", "selected_team_roles"),
        ("selectedTeamRoles", "selected_team_roles"),
        ("browser_requirement", "browser_requirement"),
        ("browserRequirement", "browser_requirement"),
        ("browser_requirement_reason", "browser_requirement_reason"),
        ("browserRequirementReason", "browser_requirement_reason"),
        ("browser_launch_url", "browser_launch_url"),
        ("browserLaunchUrl", "browser_launch_url"),
    ] {
        if target.contains_key(target_key) {
            continue;
        }
        if let Some(value) = harness.get(source_key) {
            target.insert(target_key.to_string(), value.clone());
        }
    }
}

pub(in crate::commands::aster_agent_cmd) fn build_chat_run_metadata_base(
    request: &AsterChatRequest,
    workspace_id: &str,
    effective_strategy: AsterExecutionStrategy,
    request_tool_policy: &RequestToolPolicy,
    auto_continue_enabled: bool,
    auto_continue_metadata: Option<&AutoContinuePayload>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut metadata = serde_json::Map::new();
    metadata.insert("workspace_id".to_string(), serde_json::json!(workspace_id));
    metadata.insert(
        "project_id".to_string(),
        serde_json::json!(request.project_id.clone()),
    );
    metadata.insert(
        "event_name".to_string(),
        serde_json::json!(request.event_name.clone()),
    );
    metadata.insert(
        "execution_strategy".to_string(),
        serde_json::json!(format!("{:?}", effective_strategy).to_lowercase()),
    );
    metadata.insert(
        "message_length".to_string(),
        serde_json::json!(request.message.chars().count()),
    );
    metadata.insert(
        "web_search_enabled".to_string(),
        serde_json::json!(request_tool_policy.effective_web_search),
    );
    metadata.insert(
        "web_search_mode".to_string(),
        serde_json::json!(request_tool_policy.search_mode.as_str()),
    );
    metadata.insert(
        "auto_continue_enabled".to_string(),
        serde_json::json!(auto_continue_enabled),
    );
    metadata.insert(
        "auto_continue".to_string(),
        serde_json::json!(auto_continue_metadata),
    );
    extend_map_with_harness_fields(&mut metadata, request.metadata.as_ref());
    metadata
}

pub(in crate::commands::aster_agent_cmd) fn with_string_field(
    target: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<&str>,
) {
    if target.contains_key(key) {
        return;
    }
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        target.insert(key.to_string(), serde_json::json!(value));
    }
}
