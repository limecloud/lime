//! Artifact request metadata 归一化服务
//!
//! 统一根据 request metadata 中的 harness / artifact 上下文补全 Artifact
//! 默认值，避免前端继续预计算 draft kind / source policy / request id。

use serde_json::{Map, Value};

const ARTIFACT_MEANINGFUL_KEYS: &[&str] = &[
    "artifact_mode",
    "artifactMode",
    "artifact_kind",
    "artifactKind",
    "artifact_stage",
    "artifactStage",
    "source_policy",
    "sourcePolicy",
    "workbench_surface",
    "workbenchSurface",
    "artifact_request_id",
    "artifactRequestId",
    "artifact_target_block_id",
    "artifactTargetBlockId",
    "artifact_rewrite_instruction",
    "artifactRewriteInstruction",
];

fn normalize_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn root_object(request_metadata: Option<&Value>) -> Option<&Map<String, Value>> {
    request_metadata?.as_object()
}

fn extract_harness_object(request_metadata: Option<&Value>) -> Option<&Map<String, Value>> {
    let object = root_object(request_metadata)?;
    if let Some(harness) = object.get("harness").and_then(Value::as_object) {
        return Some(harness);
    }
    Some(object)
}

fn extract_harness_string(request_metadata: Option<&Value>, keys: &[&str]) -> Option<String> {
    let harness = extract_harness_object(request_metadata)?;
    keys.iter()
        .filter_map(|key| harness.get(*key))
        .find_map(Value::as_str)
        .and_then(|value| normalize_text(Some(value)))
}

fn is_flat_artifact_metadata_key(key: &str) -> bool {
    matches!(
        key,
        "artifact_mode"
            | "artifactMode"
            | "artifact_kind"
            | "artifactKind"
            | "artifact_stage"
            | "artifactStage"
            | "source_policy"
            | "sourcePolicy"
            | "workbench_surface"
            | "workbenchSurface"
            | "artifact_request_id"
            | "artifactRequestId"
            | "artifact_target_block_id"
            | "artifactTargetBlockId"
            | "artifact_rewrite_instruction"
            | "artifactRewriteInstruction"
    )
}

fn extract_existing_artifact_object(
    request_metadata: Option<&Value>,
) -> Option<Map<String, Value>> {
    let object = root_object(request_metadata)?;
    if let Some(artifact) = object.get("artifact").and_then(Value::as_object) {
        return Some(artifact.clone());
    }

    let artifact = object
        .iter()
        .filter(|(key, _)| is_flat_artifact_metadata_key(key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Map<_, _>>();

    if artifact.is_empty() {
        None
    } else {
        Some(artifact)
    }
}

fn extract_artifact_string(artifact: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| artifact.get(*key))
        .find_map(Value::as_str)
        .and_then(|value| normalize_text(Some(value)))
}

fn infer_artifact_kind(theme: &str) -> Option<&'static str> {
    match theme.trim().to_ascii_lowercase().as_str() {
        "document" => Some("report"),
        "knowledge" => Some("analysis"),
        "planning" => Some("plan"),
        "general" => Some("brief"),
        _ => None,
    }
}

fn infer_source_policy(kind: Option<&str>) -> Option<&'static str> {
    match kind {
        Some("report") | Some("analysis") | Some("comparison") => Some("required"),
        Some("roadmap") | Some("prd") | Some("brief") | Some("plan") => Some("preferred"),
        _ => None,
    }
}

fn should_enable_artifact_draft(request_metadata: Option<&Value>) -> bool {
    if extract_harness_string(request_metadata, &["session_mode", "sessionMode"]).as_deref()
        != Some("theme_workbench")
    {
        return false;
    }

    if extract_harness_string(
        request_metadata,
        &["turn_purpose", "turnPurpose", "purpose"],
    )
    .is_some()
    {
        return false;
    }

    extract_harness_string(
        request_metadata,
        &["theme", "harness_theme", "harnessTheme"],
    )
    .as_deref()
    .and_then(infer_artifact_kind)
    .is_some()
}

fn is_meaningful_artifact_value(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
}

pub fn normalize_request_metadata_with_artifact_defaults(
    request_metadata: Option<Value>,
) -> Option<Value> {
    let request_metadata = request_metadata?;
    let Some(root) = request_metadata.as_object() else {
        return Some(request_metadata);
    };

    let request_metadata_ref = Some(&request_metadata);
    let inferred_kind = extract_harness_string(
        request_metadata_ref,
        &["theme", "harness_theme", "harnessTheme"],
    )
    .as_deref()
    .and_then(infer_artifact_kind)
    .map(str::to_string);
    let should_enable_draft = should_enable_artifact_draft(request_metadata_ref);
    let content_id = extract_harness_string(request_metadata_ref, &["content_id", "contentId"]);

    let mut artifact = extract_existing_artifact_object(request_metadata_ref).unwrap_or_default();
    let explicit_artifact_kind =
        extract_artifact_string(&artifact, &["artifact_kind", "artifactKind"]);
    let artifact_mode = extract_artifact_string(&artifact, &["artifact_mode", "artifactMode"])
        .or_else(|| should_enable_draft.then(|| "draft".to_string()));
    let artifact_kind = explicit_artifact_kind
        .clone()
        .or_else(|| should_enable_draft.then(|| inferred_kind.clone()).flatten());
    let artifact_stage = extract_artifact_string(&artifact, &["artifact_stage", "artifactStage"])
        .or_else(|| should_enable_draft.then(|| "stage2".to_string()));
    let source_policy = extract_artifact_string(&artifact, &["source_policy", "sourcePolicy"])
        .or_else(|| {
            if should_enable_draft || explicit_artifact_kind.is_some() {
                infer_source_policy(artifact_kind.as_deref()).map(str::to_string)
            } else {
                None
            }
        });
    let workbench_surface =
        extract_artifact_string(&artifact, &["workbench_surface", "workbenchSurface"])
            .or_else(|| should_enable_draft.then(|| "right_panel".to_string()));

    if let Some(value) = artifact_mode.as_ref() {
        artifact.insert("artifact_mode".to_string(), Value::String(value.clone()));
    }
    if let Some(value) = artifact_kind.as_ref() {
        artifact.insert("artifact_kind".to_string(), Value::String(value.clone()));
    }
    if let Some(value) = artifact_stage.as_ref() {
        artifact.insert("artifact_stage".to_string(), Value::String(value.clone()));
    }
    if let Some(value) = source_policy.as_ref() {
        artifact.insert("source_policy".to_string(), Value::String(value.clone()));
    }
    if let Some(value) = workbench_surface.as_ref() {
        artifact.insert(
            "workbench_surface".to_string(),
            Value::String(value.clone()),
        );
    }
    if extract_artifact_string(&artifact, &["artifact_request_id", "artifactRequestId"]).is_none()
        && artifact_mode.as_deref() == Some("draft")
    {
        if let Some(content_id) = content_id {
            artifact.insert(
                "artifact_request_id".to_string(),
                Value::String(format!("artifact:{content_id}")),
            );
        }
    }

    let mut normalized = root.clone();
    let has_meaningful_artifact_metadata = ARTIFACT_MEANINGFUL_KEYS
        .iter()
        .any(|key| is_meaningful_artifact_value(artifact.get(*key)));

    if has_meaningful_artifact_metadata {
        normalized.insert("artifact".to_string(), Value::Object(artifact));
    } else {
        normalized.remove("artifact");
    }

    Some(Value::Object(normalized))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn should_infer_theme_workbench_artifact_defaults_from_harness() {
        let metadata = json!({
            "harness": {
                "theme": "document",
                "session_mode": "theme_workbench",
                "content_id": "content-1"
            }
        });

        let normalized = normalize_request_metadata_with_artifact_defaults(Some(metadata))
            .expect("normalized metadata");

        assert_eq!(
            normalized
                .pointer("/artifact/artifact_mode")
                .and_then(Value::as_str),
            Some("draft")
        );
        assert_eq!(
            normalized
                .pointer("/artifact/artifact_kind")
                .and_then(Value::as_str),
            Some("report")
        );
        assert_eq!(
            normalized
                .pointer("/artifact/artifact_stage")
                .and_then(Value::as_str),
            Some("stage2")
        );
        assert_eq!(
            normalized
                .pointer("/artifact/source_policy")
                .and_then(Value::as_str),
            Some("required")
        );
        assert_eq!(
            normalized
                .pointer("/artifact/workbench_surface")
                .and_then(Value::as_str),
            Some("right_panel")
        );
        assert_eq!(
            normalized
                .pointer("/artifact/artifact_request_id")
                .and_then(Value::as_str),
            Some("artifact:content-1")
        );
    }

    #[test]
    fn should_skip_auto_draft_when_turn_purpose_is_present() {
        let metadata = json!({
            "harness": {
                "theme": "document",
                "session_mode": "theme_workbench",
                "turn_purpose": "content_review",
                "content_id": "content-1"
            }
        });

        let normalized = normalize_request_metadata_with_artifact_defaults(Some(metadata))
            .expect("normalized metadata");

        assert!(normalized.get("artifact").is_none());
    }

    #[test]
    fn should_preserve_explicit_artifact_and_fill_missing_source_policy() {
        let metadata = json!({
            "harness": {
                "theme": "knowledge",
                "session_mode": "default"
            },
            "artifact": {
                "artifact_kind": "analysis"
            }
        });

        let normalized = normalize_request_metadata_with_artifact_defaults(Some(metadata))
            .expect("normalized metadata");

        assert_eq!(
            normalized
                .pointer("/artifact/artifact_kind")
                .and_then(Value::as_str),
            Some("analysis")
        );
        assert_eq!(
            normalized
                .pointer("/artifact/source_policy")
                .and_then(Value::as_str),
            Some("required")
        );
        assert_eq!(
            normalized
                .pointer("/artifact/artifact_mode")
                .and_then(Value::as_str),
            None
        );
    }
}
