//! Model and Code Mode share this executor and the host's turn-bound admission.

use super::*;
use crate::tool_definition::RuntimeToolDefinition;
use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionRequest,
    RuntimeToolExecutionResult, RuntimeToolExecutor, RuntimeToolExecutorHandle,
    RuntimeToolPolicyErrorKind,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub const COMPUTER_USE_TOOL_NAME: &str = "computer_use";

#[derive(Debug, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum ComputerUseToolInput {
    Status {
        operation: ComputerUseStatusOperation,
    },
    Action {
        target: ComputerUseTargetIdentity,
        operation: ComputerUseAction,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComputerUseStatusOperation {
    Status {},
}

#[derive(Debug)]
pub struct ComputerUseToolScope<'a> {
    pub session_id: &'a str,
    pub turn_id: &'a str,
    pub call_id: &'a str,
}

#[async_trait]
pub trait ComputerUseGateway: Send + Sync {
    async fn execute(
        &self,
        scope: ComputerUseToolScope<'_>,
        input: ComputerUseToolInput,
    ) -> ComputerUseResult<Value>;
}

pub fn computer_use_tool_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        COMPUTER_USE_TOOL_NAME,
        "Use operation {action: 'status'} without a target to discover adapter readiness and exact window targets. To observe, capture or control a window, provide its exact target and an action. Window actions require an existing grant in Computer Use settings. Coordinates are in screen points. Input returns submitted; independently observe the result before claiming success. Missing consent fails immediately. This tool cannot grant access, install helpers or change permissions.",
        super::tool_schema::input_schema(),
    )
}

pub fn runtime_computer_use_executor_handle(
    gateway: Arc<dyn ComputerUseGateway>,
) -> RuntimeToolExecutorHandle {
    RuntimeToolExecutorHandle::new(Arc::new(ComputerUseExecutor { gateway }))
}

struct ComputerUseExecutor {
    gateway: Arc<dyn ComputerUseGateway>,
}

impl RuntimeToolExecutor for ComputerUseExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move {
            if request.tool_name != COMPUTER_USE_TOOL_NAME {
                return Err(tool_error("Unsupported Computer Use tool").before_handler());
            }
            let input: ComputerUseToolInput = serde_json::from_value(request.params.clone())
                .map_err(|error| {
                    tool_error(format!("Invalid Computer Use arguments: {error}")).before_handler()
                })?;
            if let ComputerUseToolInput::Action { operation, .. } = &input {
                operation
                    .validate()
                    .map_err(|error| tool_error(error.0).before_handler())?;
            }
            let identity = request
                .context
                .tool_identity()
                .filter(|identity| !identity.turn_id().is_empty() && !identity.call_id().is_empty())
                .ok_or_else(|| {
                    tool_error("Computer Use requires canonical tool and turn identity")
                        .before_handler()
                })?;
            if request.context.session_id().is_empty() {
                return Err(
                    tool_error("Computer Use requires canonical session identity").before_handler(),
                );
            }
            let scope = ComputerUseToolScope {
                session_id: request.context.session_id(),
                turn_id: identity.turn_id(),
                call_id: identity.call_id(),
            };
            let action = self.gateway.execute(scope, input);
            let value = if let Some(cancel) = request.context.cancel_token() {
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => return Err(tool_error("Computer Use canceled; input outcome may be unknown")),
                    value = action => value,
                }
            } else {
                action.await
            }.map_err(|error| tool_error(error.0))?;
            project_output(value)
        })
    }
}

fn project_output(
    mut value: Value,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    let mut metadata = HashMap::from([("tool_family".into(), json!("computer_use"))]);
    // Reuse the canonical image projection; never print the PNG as a base64 text result.
    if let Some(image) = value.as_object_mut().and_then(|value| value.remove("data")) {
        let data = image
            .as_str()
            .filter(|data| !data.is_empty() && data.len() <= 28 * 1024 * 1024)
            .ok_or_else(|| tool_error("Computer Use screenshot has an invalid image payload"))?;
        metadata.insert("model_visible_image".into(), json!(true));
        metadata.insert(
            "image_url".into(),
            json!(format!("data:image/png;base64,{data}")),
        );
        metadata.insert("mime_type".into(), json!("image/png"));
    }
    Ok(
        RuntimeToolExecutionResult::new(true, value.to_string(), None, metadata)
            .with_structured_content(value),
    )
}

fn tool_error(message: impl Into<String>) -> RuntimeToolExecutionError {
    RuntimeToolExecutionError::new(
        message,
        Some(RuntimeToolPolicyErrorKind::PermissionDenied(
            "computer_use_denied".into(),
        )),
    )
}

#[cfg(test)]
mod tests;
