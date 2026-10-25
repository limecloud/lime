use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolPolicyErrorKind, RuntimeToolTurnContext,
};
use app_server_protocol::{ImageStoryboardSlotInput, MediaTaskArtifactImageCreateParams};
use serde_json::{Map as JsonMap, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub(crate) struct ImageTaskInput {
    pub project_root_path: String,
    pub prompt: String,
    pub title: Option<String>,
    pub title_generation_result: Option<Value>,
    pub persona_context: Option<Value>,
    pub presentation: Option<Value>,
    pub taste_context: Option<Value>,
    pub mode: Option<String>,
    pub raw_text: Option<String>,
    pub layout_hint: Option<String>,
    pub size: Option<String>,
    pub aspect_ratio: Option<String>,
    pub count: Option<u32>,
    pub usage: Option<String>,
    pub style: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub executor_mode: Option<String>,
    pub outer_model: Option<String>,
    pub session_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub project_id: Option<String>,
    pub content_id: Option<String>,
    pub entry_source: Option<String>,
    pub modality_contract_key: Option<String>,
    pub modality: Option<String>,
    pub routing_slot: Option<String>,
    pub runtime_contract: Option<Value>,
    pub requested_target: Option<String>,
    pub slot_id: Option<String>,
    pub anchor_hint: Option<String>,
    pub anchor_section_title: Option<String>,
    pub anchor_text: Option<String>,
    pub target_output_id: Option<String>,
    pub target_output_ref_id: Option<String>,
    pub reference_images: Vec<String>,
    pub storyboard_slots: Vec<ImageStoryboardSlotInput>,
}

pub fn check_runtime_image_task_permissions(
    params: &Value,
    working_directory: &Path,
    session_id: &str,
    turn_context: Option<&RuntimeToolTurnContext>,
) -> Result<(), RuntimeToolExecutionError> {
    parse_image_task_input(params, working_directory, session_id, turn_context)
        .map(|_| ())
        .map_err(|error| runtime_image_task_permission_error(error.message().to_string()))
}

pub(crate) fn parse_image_task_input(
    params: &Value,
    working_directory: &Path,
    session_id: &str,
    turn_context: Option<&RuntimeToolTurnContext>,
) -> Result<ImageTaskInput, RuntimeToolExecutionError> {
    let prompt = required_string(params, &["prompt"])?;
    let size = optional_string(params, &["size"]);
    let style = optional_string(params, &["style"]);
    let usage = optional_string(params, &["usage"]);
    let mode = optional_string(params, &["mode"]);
    let layout_hint = optional_string(params, &["layoutHint", "layout_hint"]);
    let count = optional_u32(params, &["count"])?;
    let aspect_ratio = optional_string(params, &["aspectRatio", "aspect_ratio"]);
    let provider_id = optional_string(params, &["provider_id", "providerId"]);
    let model = optional_string(params, &["model"]);
    let executor_mode = optional_string(params, &["executor_mode", "executorMode"]);
    let outer_model = optional_string(params, &["outer_model", "outerModel"]);
    let project_root_path = resolve_project_root_path(params, working_directory)?;
    let session_id = required_identity(
        optional_string(params, &["session_id", "sessionId"])
            .or_else(|| turn_context_identity(turn_context, SESSION_ID_KEYS))
            .or_else(|| non_empty_string(session_id)),
        "session_id",
    )?;
    let thread_id = required_identity(
        optional_string(params, &["thread_id", "threadId"])
            .or_else(|| turn_context_identity(turn_context, THREAD_ID_KEYS)),
        "thread_id",
    )?;
    let turn_id = required_identity(
        optional_string(params, &["turn_id", "turnId"])
            .or_else(|| turn_context_identity(turn_context, TURN_ID_KEYS)),
        "turn_id",
    )?;
    let project_id = optional_string(params, &["project_id", "projectId"]);
    let content_id = optional_string(params, &["content_id", "contentId"]);
    let entry_source = optional_string(params, &["entry_source", "entrySource"]);
    let requested_target = optional_string(params, &["requested_target", "requestedTarget"]);
    let modality_contract_key =
        optional_string(params, &["modality_contract_key", "modalityContractKey"]);
    let modality = optional_string(params, &["modality"]);
    let routing_slot = optional_string(params, &["routing_slot", "routingSlot"]);
    let runtime_contract = params
        .get("runtime_contract")
        .cloned()
        .or_else(|| params.get("runtimeContract").cloned());
    let slot_id = optional_string(params, &["slot_id", "slotId"]);
    let anchor_hint = optional_string(params, &["anchor_hint", "anchorHint"]);
    let anchor_section_title =
        optional_string(params, &["anchor_section_title", "anchorSectionTitle"]);
    let anchor_text = optional_string(params, &["anchor_text", "anchorText"]);
    let target_output_id = optional_string(params, &["target_output_id", "targetOutputId"]);
    let target_output_ref_id =
        optional_string(params, &["target_output_ref_id", "targetOutputRefId"]);
    let title = optional_string(params, &["title"]);
    let title_generation_result = params
        .get("title_generation_result")
        .cloned()
        .or_else(|| params.get("titleGenerationResult").cloned());
    let persona_context = params
        .get("persona_context")
        .cloned()
        .or_else(|| params.get("personaContext").cloned());
    let presentation = params.get("presentation").cloned();
    let taste_context = params
        .get("taste_context")
        .cloned()
        .or_else(|| params.get("tasteContext").cloned());
    let raw_text = optional_string(params, &["raw_text", "rawText"]);
    let reference_images = string_vec(params, &["reference_images", "referenceImages"]);
    let storyboard_slots: Vec<ImageStoryboardSlotInput> = params
        .get("storyboard_slots")
        .or_else(|| params.get("storyboardSlots"))
        .cloned()
        .map(|value| {
            serde_json::from_value(value).map_err(|error| {
                runtime_image_task_error(format!("storyboard_slots invalid: {error}"))
            })
        })
        .transpose()?
        .unwrap_or_default();

    if prompt.trim().is_empty() {
        return Err(runtime_image_task_error("prompt 不能为空"));
    }
    if size.as_deref().is_some_and(|value| value.trim().is_empty()) {
        return Err(runtime_image_task_error("size 不能为空"));
    }
    if layout_hint.as_deref() == Some("storyboard_3x3") && storyboard_slots.is_empty() {
        return Err(runtime_image_task_error(
            "layout_hint=storyboard_3x3 时 storyboard_slots 不能为空",
        ));
    }

    Ok(ImageTaskInput {
        project_root_path,
        prompt,
        title,
        title_generation_result,
        persona_context,
        presentation,
        taste_context,
        mode,
        raw_text,
        layout_hint,
        size,
        aspect_ratio,
        count,
        usage,
        style,
        provider_id,
        model,
        executor_mode,
        outer_model,
        session_id,
        thread_id,
        turn_id,
        project_id,
        content_id,
        entry_source,
        modality_contract_key,
        modality,
        routing_slot,
        runtime_contract,
        requested_target,
        slot_id,
        anchor_hint,
        anchor_section_title,
        anchor_text,
        target_output_id,
        target_output_ref_id,
        reference_images,
        storyboard_slots,
    })
}

pub(crate) fn build_create_params(input: ImageTaskInput) -> MediaTaskArtifactImageCreateParams {
    MediaTaskArtifactImageCreateParams {
        project_root_path: input.project_root_path,
        prompt: input.prompt,
        title: input.title,
        title_generation_result: input.title_generation_result,
        persona_context: input.persona_context,
        presentation: input.presentation,
        taste_context: input.taste_context,
        mode: input.mode,
        raw_text: input.raw_text,
        layout_hint: input.layout_hint,
        size: input.size,
        aspect_ratio: input.aspect_ratio,
        count: input.count,
        usage: input.usage,
        style: input.style,
        provider_id: input.provider_id,
        model: input.model,
        executor_mode: input.executor_mode,
        outer_model: input.outer_model,
        session_id: Some(input.session_id),
        thread_id: Some(input.thread_id),
        turn_id: Some(input.turn_id),
        project_id: input.project_id,
        content_id: input.content_id,
        entry_source: input.entry_source,
        modality_contract_key: input.modality_contract_key,
        modality: input.modality,
        required_capabilities: Vec::new(),
        routing_slot: input.routing_slot,
        runtime_contract: input.runtime_contract,
        requested_target: input.requested_target,
        slot_id: input.slot_id,
        anchor_hint: input.anchor_hint,
        anchor_section_title: input.anchor_section_title,
        anchor_text: input.anchor_text,
        target_output_id: input.target_output_id,
        target_output_ref_id: input.target_output_ref_id,
        reference_images: input.reference_images,
        storyboard_slots: input.storyboard_slots,
    }
}

pub(crate) fn runtime_image_task_error(message: impl Into<String>) -> RuntimeToolExecutionError {
    let message = message.into();
    RuntimeToolExecutionError::new(
        message.clone(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(message)),
    )
}

const SESSION_ID_KEYS: &[&str] = &["session_id", "sessionId"];
const THREAD_ID_KEYS: &[&str] = &["thread_id", "threadId"];
const TURN_ID_KEYS: &[&str] = &["turn_id", "turnId"];
const SCOPE_POINTERS: &[&str] = &[
    "/app_server_runtime_backend",
    "/action_scope",
    "/actionScope",
    "/scope",
];

fn resolve_project_root_path(
    params: &Value,
    working_directory: &Path,
) -> Result<String, RuntimeToolExecutionError> {
    if let Some(path) = optional_string(params, &["project_root_path", "projectRootPath"]) {
        return validate_absolute_path(&path);
    }

    if !working_directory.is_absolute() {
        return Err(runtime_image_task_error(
            "project_root_path requires an absolute working directory",
        ));
    }
    validate_absolute_path(&working_directory.to_string_lossy())
}

fn validate_absolute_path(path: &str) -> Result<String, RuntimeToolExecutionError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(runtime_image_task_error("project_root_path 不能为空"));
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(runtime_image_task_error("project_root_path 必须是绝对路径"));
    }
    Ok(candidate.to_string_lossy().to_string())
}

fn required_identity(
    value: Option<String>,
    field: &str,
) -> Result<String, RuntimeToolExecutionError> {
    value
        .and_then(|value| non_empty_string(&value))
        .ok_or_else(|| runtime_image_task_error(format!("{field} 不能为空")))
}

fn required_string(params: &Value, keys: &[&str]) -> Result<String, RuntimeToolExecutionError> {
    optional_string(params, keys)
        .ok_or_else(|| runtime_image_task_error(format!("Missing required parameter: {}", keys[0])))
}

fn optional_string(params: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| params.get(*key))
        .find_map(Value::as_str)
        .and_then(non_empty_string)
}

fn optional_u32(params: &Value, keys: &[&str]) -> Result<Option<u32>, RuntimeToolExecutionError> {
    let Some(value) = keys.iter().filter_map(|key| params.get(*key)).next() else {
        return Ok(None);
    };
    let Some(number) = value.as_u64() else {
        return Err(runtime_image_task_error(format!(
            "{} must be a non-negative integer",
            keys[0]
        )));
    };
    u32::try_from(number)
        .map(Some)
        .map_err(|_| runtime_image_task_error(format!("{} is too large", keys[0])))
}

fn string_vec(params: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .filter_map(|key| params.get(*key))
        .find_map(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(non_empty_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn turn_context_identity(
    turn_context: Option<&RuntimeToolTurnContext>,
    keys: &[&str],
) -> Option<String> {
    let metadata = &turn_context?.metadata;
    metadata_string(metadata, keys).or_else(|| metadata_scope_string(metadata, keys))
}

fn metadata_string(metadata: &HashMap<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| metadata.get(*key))
        .find_map(Value::as_str)
        .and_then(non_empty_string)
}

fn metadata_scope_string(metadata: &HashMap<String, Value>, keys: &[&str]) -> Option<String> {
    let value = Value::Object(
        metadata
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect::<JsonMap<String, Value>>(),
    );
    SCOPE_POINTERS
        .iter()
        .filter_map(|pointer| value.pointer(pointer))
        .find_map(|scope| {
            keys.iter()
                .filter_map(|key| scope.get(*key))
                .find_map(Value::as_str)
                .and_then(non_empty_string)
        })
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn runtime_image_task_permission_error(message: impl Into<String>) -> RuntimeToolExecutionError {
    let message = message.into();
    RuntimeToolExecutionError::new(
        message.clone(),
        Some(RuntimeToolPolicyErrorKind::PermissionDenied(message)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;
    use tempfile::TempDir;

    #[test]
    fn parses_identity_from_turn_context_metadata() {
        let workspace = TempDir::new().expect("workspace");
        let turn_context = RuntimeToolTurnContext {
            metadata: HashMap::from([
                ("thread_id".to_string(), json!("thread-image-1")),
                ("turn_id".to_string(), json!("turn-image-1")),
            ]),
            ..RuntimeToolTurnContext::default()
        };

        let input = parse_image_task_input(
            &json!({
                "project_root_path": workspace.path().to_string_lossy(),
                "prompt": "生成一张封面"
            }),
            workspace.path(),
            "session-image-1",
            Some(&turn_context),
        )
        .expect("input");

        assert_eq!(input.session_id, "session-image-1");
        assert_eq!(input.thread_id, "thread-image-1");
        assert_eq!(input.turn_id, "turn-image-1");
    }

    #[test]
    fn parses_canonical_app_server_turn_identity_without_model_supplied_ids() {
        let workspace = TempDir::new().expect("workspace");
        let context = RuntimeToolTurnContext {
            metadata: HashMap::from([("app_server_runtime_backend".into(), json!({
                "sessionId": "session-current", "threadId": "thread-current", "turnId": "turn-current"
            }))]),
            ..RuntimeToolTurnContext::default()
        };
        let input = parse_image_task_input(
            &json!({ "prompt": "封面" }), workspace.path(), "session-current", Some(&context),
        ).expect("canonical identity");
        assert_eq!(input.thread_id, "thread-current");
        assert_eq!(input.turn_id, "turn-current");
        assert_eq!(input.session_id, "session-current");
    }

    #[test]
    fn rejects_storyboard_without_slots() {
        let workspace = TempDir::new().expect("workspace");
        let error = parse_image_task_input(
            &json!({
                "project_root_path": workspace.path().to_string_lossy(),
                "prompt": "生成分镜",
                "layout_hint": "storyboard_3x3",
                "session_id": "session-image-1",
                "thread_id": "thread-image-1",
                "turn_id": "turn-image-1"
            }),
            workspace.path(),
            "",
            None,
        )
        .expect_err("storyboard slots should be required");

        assert!(error.message().contains("storyboard_slots"));
    }
}
