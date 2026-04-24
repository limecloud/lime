use super::*;
use lime_media_runtime::{parse_media_task_output, MediaRuntimeError, MediaTaskOutput};

const CREATION_TASK_EVENT_NAME: &str = "lime://creation_task_submitted";

fn read_payload_string(payload: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(value) = payload.get(*key) else {
            continue;
        };
        if let Some(text) = value.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn read_payload_u64(payload: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    for key in keys {
        let Some(value) = payload.get(*key) else {
            continue;
        };
        if let Some(number) = value.as_u64() {
            return Some(number);
        }
        if let Some(text) = value.as_str() {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(parsed) = trimmed.parse::<u64>() {
                return Some(parsed);
            }
        }
    }
    None
}

fn read_output_slot_id(output: &MediaTaskOutput) -> Option<String> {
    output
        .record
        .relationships
        .slot_id
        .clone()
        .or_else(|| read_payload_string(&output.record.payload, &["slot_id", "slotId"]))
}

fn read_output_result_string(output: &MediaTaskOutput, keys: &[&str]) -> Option<String> {
    let result = output.record.result.as_ref()?;
    read_payload_string(result, keys)
}

fn read_output_result_u64(output: &MediaTaskOutput, keys: &[&str]) -> Option<u64> {
    let result = output.record.result.as_ref()?;
    read_payload_u64(result, keys)
}

pub(crate) fn tool_error_from_media_runtime(error: MediaRuntimeError) -> ToolError {
    match error {
        MediaRuntimeError::InvalidParams(message) => ToolError::invalid_params(message),
        MediaRuntimeError::Io(message)
        | MediaRuntimeError::Conflict(message)
        | MediaRuntimeError::InvalidState(message)
        | MediaRuntimeError::NotRetryable(message) => ToolError::execution_failed(message),
        MediaRuntimeError::TaskNotFound { task_ref } => {
            ToolError::execution_failed(format!("未找到任务: {task_ref}"))
        }
    }
}

pub(crate) fn emit_media_creation_task_event(app_handle: &AppHandle, output: &MediaTaskOutput) {
    let payload_record = &output.record.payload;
    let payload = serde_json::json!({
        "task_id": output.task_id,
        "task_type": output.task_type,
        "task_family": output.task_family,
        "status": output.status,
        "current_attempt_id": output.current_attempt_id,
        "path": output.path,
        "absolute_path": output.absolute_path,
        "reused_existing": output.reused_existing,
        "prompt": read_payload_string(payload_record, &["prompt"]),
        "size": read_payload_string(payload_record, &["size", "resolution"]),
        "mode": read_payload_string(payload_record, &["mode"]),
        "layout_hint": read_payload_string(payload_record, &["layout_hint", "layoutHint"]),
        "count": read_payload_u64(payload_record, &["count", "image_count", "imageCount"]),
        "storyboard_slots": payload_record.get("storyboard_slots").cloned(),
        "raw_text": read_payload_string(payload_record, &["raw_text", "rawText"]),
        "session_id": read_payload_string(payload_record, &["session_id", "sessionId"]),
        "project_id": read_payload_string(payload_record, &["project_id", "projectId"]),
        "content_id": read_payload_string(payload_record, &["content_id", "contentId"]),
        "entry_source": read_payload_string(payload_record, &["entry_source", "entrySource"]),
        "requested_target": read_payload_string(payload_record, &["requested_target", "requestedTarget"]),
        "slot_id": read_output_slot_id(output),
        "anchor_hint": read_payload_string(payload_record, &["anchor_hint", "anchorHint"]),
        "anchor_section_title": read_payload_string(payload_record, &["anchor_section_title", "anchorSectionTitle"]),
        "anchor_text": read_payload_string(payload_record, &["anchor_text", "anchorText"]),
        "requested_count": read_output_result_u64(output, &["requested_count", "requestedCount"]),
        "received_count": read_output_result_u64(output, &["received_count", "receivedCount"]),
    });

    if let Err(error) = app_handle.emit(CREATION_TASK_EVENT_NAME, &payload) {
        tracing::warn!(
            "[AsterAgent] media creation_task_submitted 事件发送失败: {}",
            error
        );
    }
}

pub(crate) fn attach_media_task_metadata(
    result: ToolResult,
    output: &MediaTaskOutput,
) -> ToolResult {
    result
        .with_metadata("task_id", serde_json::json!(output.task_id))
        .with_metadata("task_type", serde_json::json!(output.task_type))
        .with_metadata("task_family", serde_json::json!(output.task_family))
        .with_metadata("path", serde_json::json!(output.absolute_path))
        .with_metadata("artifact_path", serde_json::json!(output.path))
        .with_metadata(
            "absolute_artifact_path",
            serde_json::json!(output.absolute_artifact_path),
        )
        .with_metadata("status", serde_json::json!(output.status))
        .with_metadata(
            "current_attempt_id",
            serde_json::json!(output.current_attempt_id),
        )
        .with_metadata(
            "prompt",
            serde_json::json!(read_payload_string(&output.record.payload, &["prompt"])),
        )
        .with_metadata(
            "size",
            serde_json::json!(read_payload_string(
                &output.record.payload,
                &["size", "resolution"]
            )),
        )
        .with_metadata(
            "layout_hint",
            serde_json::json!(read_payload_string(
                &output.record.payload,
                &["layout_hint", "layoutHint"]
            )),
        )
        .with_metadata(
            "storyboard_slots",
            serde_json::json!(output.record.payload.get("storyboard_slots").cloned()),
        )
        .with_metadata(
            "project_id",
            serde_json::json!(read_payload_string(
                &output.record.payload,
                &["project_id", "projectId"]
            )),
        )
        .with_metadata(
            "content_id",
            serde_json::json!(read_payload_string(
                &output.record.payload,
                &["content_id", "contentId"]
            )),
        )
        .with_metadata(
            "provider_id",
            serde_json::json!(read_output_result_string(
                output,
                &["provider_id", "providerId"]
            )),
        )
        .with_metadata(
            "model",
            serde_json::json!(read_output_result_string(output, &["model"])),
        )
        .with_metadata(
            "requested_count",
            serde_json::json!(read_output_result_u64(
                output,
                &["requested_count", "requestedCount"]
            )),
        )
        .with_metadata(
            "received_count",
            serde_json::json!(read_output_result_u64(
                output,
                &["received_count", "receivedCount"]
            )),
        )
        .with_metadata("artifact_paths", serde_json::json!(output.artifact_paths()))
}

pub(crate) fn enrich_tool_result_from_media_cli_output(
    result: ToolResult,
    raw_output: &str,
    app_handle: Option<&AppHandle>,
) -> ToolResult {
    let Some(parsed_output) = parse_media_task_output(raw_output) else {
        return result;
    };

    if let Some(app_handle) = app_handle {
        emit_media_creation_task_event(app_handle, &parsed_output);
    }

    attach_media_task_metadata(result, &parsed_output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_media_runtime::{MediaTaskArtifactRecord, MediaTaskOutput};

    #[test]
    fn enrich_tool_result_from_media_cli_output_should_attach_artifact_metadata() {
        let output = MediaTaskOutput {
            success: true,
            task_id: "task-1".to_string(),
            task_type: "image_generate".to_string(),
            task_family: "image".to_string(),
            status: "pending_submit".to_string(),
            normalized_status: "pending".to_string(),
            current_attempt_id: Some("attempt-1".to_string()),
            attempt_count: 1,
            last_error: None,
            progress: lime_media_runtime::TaskProgress::default(),
            ui_hints: lime_media_runtime::TaskUiHints::default(),
            path: ".lime/tasks/image_generate/demo.json".to_string(),
            absolute_path: "/tmp/demo.json".to_string(),
            artifact_path: ".lime/tasks/image_generate/demo.json".to_string(),
            absolute_artifact_path: "/tmp/demo.json".to_string(),
            reused_existing: false,
            idempotency_key: None,
            record: MediaTaskArtifactRecord {
                task_id: "task-1".to_string(),
                task_type: "image_generate".to_string(),
                task_family: "image".to_string(),
                title: None,
                summary: Some("demo".to_string()),
                payload: serde_json::json!({ "prompt": "demo" }),
                status: "pending_submit".to_string(),
                normalized_status: "pending".to_string(),
                created_at: "2026-04-03T00:00:00Z".to_string(),
                updated_at: None,
                submitted_at: None,
                started_at: None,
                completed_at: None,
                cancelled_at: None,
                idempotency_key: None,
                retry_count: 0,
                source_task_id: None,
                result: None,
                last_error: None,
                current_attempt_id: Some("attempt-1".to_string()),
                attempts: vec![lime_media_runtime::TaskAttemptRecord {
                    attempt_id: "attempt-1".to_string(),
                    attempt_index: 1,
                    status: "pending_submit".to_string(),
                    input_snapshot: serde_json::json!({ "prompt": "demo" }),
                    ..lime_media_runtime::TaskAttemptRecord::default()
                }],
                relationships: lime_media_runtime::TaskRelationships::default(),
                progress: lime_media_runtime::TaskProgress::default(),
                ui_hints: lime_media_runtime::TaskUiHints::default(),
            },
        };
        let serialized = serde_json::to_string(&output).expect("serialize output");

        let result = enrich_tool_result_from_media_cli_output(
            ToolResult::success(serialized.clone()),
            &serialized,
            None,
        );

        assert_eq!(
            result.metadata.get("task_type"),
            Some(&serde_json::json!("image_generate"))
        );
        assert_eq!(
            result.metadata.get("task_family"),
            Some(&serde_json::json!("image"))
        );
        assert_eq!(
            result.metadata.get("artifact_paths"),
            Some(&serde_json::json!([".lime/tasks/image_generate/demo.json"]))
        );
    }
}
