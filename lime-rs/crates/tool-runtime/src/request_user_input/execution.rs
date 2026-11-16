use super::{
    RequestUserInputProjection, RequestUserInputRequest, RequestUserInputSurfaceError,
    normalize_request_user_input_result, parse_request_user_input_tool_input,
    project_request_user_input_result,
};
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

pub type RequestUserInputCallback = Arc<
    dyn Fn(RequestUserInputRequest) -> Pin<Box<dyn Future<Output = Option<Value>> + Send>>
        + Send
        + Sync,
>;

pub async fn execute_request_user_input(
    params: Value,
    callback: Option<&RequestUserInputCallback>,
    timeout: Duration,
) -> Result<RequestUserInputProjection, RequestUserInputSurfaceError> {
    let request = parse_request_user_input_tool_input(params)?;
    let callback = callback.ok_or_else(|| {
        RequestUserInputSurfaceError::execution_failed(
            "No callback configured for request_user_input",
        )
    })?;
    let response = tokio::time::timeout(timeout, callback(request.clone()))
        .await
        .map_err(|_| {
            RequestUserInputSurfaceError::execution_failed(format!(
                "request_user_input timed out after {timeout:?}"
            ))
        })?
        .ok_or_else(|| {
            RequestUserInputSurfaceError::execution_failed(
                "User cancelled the request_user_input interaction",
            )
        })?;
    let result = normalize_request_user_input_result(&request, response)?;

    Ok(project_request_user_input_result(&request, &result))
}
