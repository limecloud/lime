use super::{args_or_default, parse_nested_arg};
use crate::commands::aster_agent_cmd::tool_runtime::media_cli_bridge;
use crate::commands::media_task_cmd::{
    cancel_media_task_artifact_inner, create_image_generation_task_artifact_inner,
    get_media_task_artifact_inner, list_media_task_artifacts_inner,
    start_image_generation_task_worker_if_needed, CreateImageGenerationTaskArtifactRequest,
    ListMediaTaskArtifactsRequest, MediaTaskLookupRequest,
};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use std::io;

type DynError = Box<dyn std::error::Error>;

fn to_dyn_error(message: String) -> DynError {
    io::Error::other(message).into()
}

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "create_image_generation_task_artifact" => {
            let args = args_or_default(args);
            let request: CreateImageGenerationTaskArtifactRequest =
                parse_nested_arg(&args, "request")?;
            let project_root_path = request.project_root_path.trim().to_string();
            let output =
                create_image_generation_task_artifact_inner(request).map_err(to_dyn_error)?;
            if let Some(app_handle) = state.app_handle.as_ref() {
                media_cli_bridge::emit_media_creation_task_event(app_handle, &output);
                start_image_generation_task_worker_if_needed(
                    app_handle,
                    project_root_path.as_str(),
                    &output,
                );
            }
            serde_json::to_value(output)?
        }
        "get_media_task_artifact" => {
            let args = args_or_default(args);
            let request: MediaTaskLookupRequest = parse_nested_arg(&args, "request")?;
            serde_json::to_value(get_media_task_artifact_inner(request).map_err(to_dyn_error)?)?
        }
        "list_media_task_artifacts" => {
            let args = args_or_default(args);
            let request: ListMediaTaskArtifactsRequest = parse_nested_arg(&args, "request")?;
            serde_json::to_value(list_media_task_artifacts_inner(request).map_err(to_dyn_error)?)?
        }
        "cancel_media_task_artifact" => {
            let args = args_or_default(args);
            let request: MediaTaskLookupRequest = parse_nested_arg(&args, "request")?;
            let output = cancel_media_task_artifact_inner(request).map_err(to_dyn_error)?;
            if let Some(app_handle) = state.app_handle.as_ref() {
                media_cli_bridge::emit_media_creation_task_event(app_handle, &output);
            }
            serde_json::to_value(output)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
