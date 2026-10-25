//! 当前 provider sampling step 的工具执行适配器。

use super::{is_web_tool, mcp_step_snapshot};
use crate::protocol::{AgentEvent, AgentToolProgressPayload};
use crate::request_tool_policy::RequestToolPolicy;
use crate::runtime_state::{AgentRuntimeState, EffectivePermissionGrant};
use agent_protocol::{ModeKind, ThreadId};
use agent_runtime::session_loop::RuntimeSessionInputHandle;
use futures::StreamExt;
use rmcp::model::{CallToolResult, ErrorData, ServerNotification};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;
use tokio_util::sync::CancellationToken;
use tool_runtime::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionRequest,
    RuntimeToolExecutionResult, RuntimeToolExecutor, RuntimeToolPolicyErrorKind,
};

const GRANTED_PERMISSIONS_METADATA_KEY: &str = "grantedPermissions";
const STRICT_AUTO_REVIEW_METADATA_KEY: &str = "strictAutoReview";

pub(super) mod approval;
mod guardian;
pub(super) mod orchestration;

#[derive(Clone)]
pub(super) struct CurrentTurnToolExecutor {
    pub(super) internal_agent_policy: Option<tool_runtime::internal_agent::InternalAgentPolicy>,
    pub(super) state: AgentRuntimeState,
    pub(super) policy: RequestToolPolicy,
    pub(super) event_sender: UnboundedSender<AgentEvent>,
    pub(super) thread_id: ThreadId,
    pub(super) mcp_snapshot: tool_runtime::mcp_connection::McpStepSnapshot,
    pub(super) deferred_tools: mcp_step_snapshot::DeferredToolSelections,
    pub(super) agent_control_gateway:
        Option<tool_runtime::agent_control::AgentControlGatewayHandle>,
    pub(super) pending_input: Option<RuntimeSessionInputHandle>,
    pub(super) dynamic_tool_routes: mcp_step_snapshot::DynamicToolRoutes,
    pub(super) async_user_input_enabled: bool,
}

impl RuntimeToolExecutor for CurrentTurnToolExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move {
            if let Some(policy) = self.internal_agent_policy.as_ref() {
                if !policy.allows_tool(request.tool_name) {
                    return Err(RuntimeToolExecutionError::new(
                        format!("internal memory agent cannot call {}", request.tool_name),
                        Some(RuntimeToolPolicyErrorKind::PermissionDenied(
                            "internal_agent".to_string(),
                        )),
                    )
                    .before_handler());
                }
            }
            if self.policy.matches_any_disallowed_tool(request.tool_name) {
                return Err(RuntimeToolExecutionError::new(
                    format!("当前请求策略禁止工具调用: {}", request.tool_name),
                    Some(RuntimeToolPolicyErrorKind::PermissionDenied(
                        "request_tool_policy".to_string(),
                    )),
                )
                .before_handler());
            }
            if !self.policy.allows_web_search() && is_web_tool(request.tool_name) {
                return Err(RuntimeToolExecutionError::new(
                    format!("当前请求未启用联网工具: {}", request.tool_name),
                    Some(RuntimeToolPolicyErrorKind::PermissionDenied(
                        "web_search_disabled".to_string(),
                    )),
                )
                .before_handler());
            }

            if request.tool_name == mcp_step_snapshot::GET_CONTEXT_REMAINING_TOOL_NAME {
                let tokens_left = context_tokens_left(&request, self.pending_input.as_ref()).await;
                let output = json!({"tokens_left": tokens_left});
                let mut metadata = HashMap::new();
                metadata.insert("contextRemainingTokens".to_string(), output.clone());
                return Ok(RuntimeToolExecutionResult::new(
                    true,
                    output.to_string(),
                    None,
                    metadata,
                ));
            }

            if request.tool_name == mcp_step_snapshot::NEW_CONTEXT_WINDOW_TOOL_NAME {
                if request
                    .turn_context
                    .and_then(|context| context.metadata.get("lime_runtime"))
                    .and_then(|runtime| runtime.get("auto_compact"))
                    .and_then(Value::as_bool)
                    == Some(false)
                {
                    return Err(RuntimeToolExecutionError::new(
                        "Context resets are disabled for this thread.",
                        Some(RuntimeToolPolicyErrorKind::PermissionDenied(
                            "auto_compaction_disabled".to_string(),
                        )),
                    )
                    .before_handler());
                }
                let input = self.pending_input.as_ref().ok_or_else(|| {
                    RuntimeToolExecutionError::new(
                        "new_context requires the active session input owner",
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "session_input_owner_missing".to_string(),
                        )),
                    )
                    .before_handler()
                })?;
                input.request_context_rollover().await;
                return Ok(RuntimeToolExecutionResult::new(
                    true,
                    "A new context window will start without summarizing conversation history."
                        .to_string(),
                    None,
                    HashMap::new(),
                ));
            }

            if tool_runtime::request_permissions::is_request_permissions_tool(request.tool_name) {
                approval::ensure_user_reviewer(request)?;
                let args = tool_runtime::request_permissions::parse_request_permissions_args(
                    request.params,
                    request.context.working_directory(),
                )
                .map_err(|error| {
                    RuntimeToolExecutionError::new(
                        error,
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "request_permissions_invalid".to_string(),
                        )),
                    )
                    .before_handler()
                })?;
                if args
                    .environment_id
                    .as_deref()
                    .is_some_and(|environment_id| environment_id != "local")
                {
                    return Err(RuntimeToolExecutionError::new(
                        "request_permissions references an unknown environment_id",
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "request_permissions_environment_unknown".to_string(),
                        )),
                    )
                    .before_handler());
                }
                let (scope, request_call_id) = action_scope(request, &self.thread_id)
                    .map_err(RuntimeToolExecutionError::before_handler)?;
                let scope = scope.ok_or_else(|| {
                    RuntimeToolExecutionError::new(
                        "request_permissions requires canonical action scope",
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "request_permissions_scope_missing".to_string(),
                        )),
                    )
                    .before_handler()
                })?;
                let session_id = scope.session_id.clone().ok_or_else(|| {
                    RuntimeToolExecutionError::new(
                        "request_permissions requires canonical session_id",
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "request_permissions_scope_missing".to_string(),
                        )),
                    )
                    .before_handler()
                })?;
                let turn_id = scope.turn_id.clone().ok_or_else(|| {
                    RuntimeToolExecutionError::new(
                        "request_permissions requires canonical turn_id",
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "request_permissions_scope_missing".to_string(),
                        )),
                    )
                    .before_handler()
                })?;
                let response_handle = self.pending_input.clone().ok_or_else(|| {
                    RuntimeToolExecutionError::new(
                        "request_permissions requires the active session response owner",
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "session_response_owner_missing".to_string(),
                        )),
                    )
                    .before_handler()
                })?;
                let permission_request =
                    agent_runtime::request_permissions::RequestPermissionsRequest::new(
                        agent_runtime::request_permissions::RequestPermissionsIdentity::new(
                            session_id.clone(),
                            self.thread_id.as_str(),
                            turn_id.clone(),
                            request_call_id,
                        ),
                        args.environment_id,
                        request.context.working_directory().to_string_lossy(),
                        args.reason,
                        args.permissions,
                    );
                let response = crate::request_permissions_bridge::request_permissions(
                    self.state.action_required_state(),
                    response_handle,
                    permission_request,
                    self.event_sender.clone(),
                )
                .await
                .map_err(|error| {
                    RuntimeToolExecutionError::new(
                        error.to_string(),
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            error.code().to_string(),
                        )),
                    )
                })?;
                self.state
                    .record_permission_grant(&session_id, &turn_id, &response)
                    .await;
                let output = serde_json::to_string(&response).map_err(|error| {
                    RuntimeToolExecutionError::new(
                        format!("failed to serialize request_permissions response: {error}"),
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "request_permissions_response".to_string(),
                        )),
                    )
                })?;
                return Ok(RuntimeToolExecutionResult::new(
                    true,
                    output,
                    None,
                    HashMap::from([
                        (
                            "permission_scope".to_string(),
                            serde_json::to_value(response.scope).unwrap_or(Value::Null),
                        ),
                        (
                            "granted_permissions".to_string(),
                            serde_json::to_value(response.permissions).unwrap_or(Value::Null),
                        ),
                        (
                            "strict_auto_review".to_string(),
                            Value::Bool(response.strict_auto_review.unwrap_or(false)),
                        ),
                    ]),
                ));
            }

            if request.tool_name
                == tool_runtime::request_user_input_async::REQUEST_USER_INPUT_ASYNC_TOOL_NAME
            {
                if !self.async_user_input_enabled {
                    return Err(RuntimeToolExecutionError::new(
                        "request_user_input_async is not available for this sampling step",
                        Some(RuntimeToolPolicyErrorKind::PermissionDenied(
                            "request_user_input_async_disabled".to_string(),
                        )),
                    )
                    .before_handler());
                }
                tool_runtime::request_user_input_async::parse_request_user_input_async_args(
                    request.params,
                )
                .map_err(|error| RuntimeToolExecutionError::new(error, None).before_handler())?;
                return Ok(RuntimeToolExecutionResult::new(
                    true,
                    tool_runtime::request_user_input_async::REQUEST_USER_INPUT_ASYNC_ACCEPTED
                        .to_string(),
                    None,
                    HashMap::new(),
                ));
            }

            if tool_runtime::request_user_input::request_user_input_canonical_tool_name(
                request.tool_name,
            )
            .is_some()
            {
                let (scope, request_call_id) = action_scope(request, &self.thread_id)
                    .map_err(RuntimeToolExecutionError::before_handler)?;
                let response_handle = self.pending_input.clone().ok_or_else(|| {
                    RuntimeToolExecutionError::new(
                        "request_user_input requires the active session response owner",
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "session_response_owner_missing".to_string(),
                        )),
                    )
                    .before_handler()
                })?;
                let callback = crate::request_user_input_bridge::create_request_user_input_callback(
                    self.state.action_required_state(),
                    response_handle,
                    request_call_id,
                    request_user_input_is_blocking(request.turn_context),
                    scope,
                    self.event_sender.clone(),
                );
                let projection = tool_runtime::request_user_input::execute_request_user_input(
                    request.params.clone(),
                    Some(&callback),
                    Duration::from_secs(
                        tool_runtime::request_user_input::DEFAULT_REQUEST_USER_INPUT_TIMEOUT_SECS,
                    ),
                )
                .await
                .map_err(|error| {
                    RuntimeToolExecutionError::new(
                        error.to_string(),
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "request_user_input".to_string(),
                        )),
                    )
                })?;
                return Ok(RuntimeToolExecutionResult::new(
                    true,
                    projection.output,
                    None,
                    projection.metadata.into_iter().collect(),
                ));
            }

            if let Some(route) = self.dynamic_tool_routes.get(request.tool_name) {
                return crate::current_provider_turn::dynamic_tool_bridge::call_dynamic_tool(
                    request,
                    &self.thread_id,
                    route,
                    self.pending_input.clone(),
                    &self.event_sender,
                    &self.state,
                )
                .await;
            }

            let permission_grant = if self.internal_agent_policy.is_some() {
                EffectivePermissionGrant::default()
            } else if let Some(identity) = request.context.tool_identity() {
                self.state
                    .effective_permission_grant(request.context.session_id(), identity.turn_id())
                    .await
            } else {
                EffectivePermissionGrant::default()
            };
            let trusted_turn_context =
                trusted_permission_turn_context(request.turn_context, &permission_grant);
            let request = RuntimeToolExecutionRequest {
                turn_context: trusted_turn_context.as_ref(),
                ..request
            };

            orchestration::orchestrate_current_tool_execution(self, request, permission_grant).await
        })
    }
}

async fn context_tokens_left(
    request: &RuntimeToolExecutionRequest<'_>,
    pending_input: Option<&RuntimeSessionInputHandle>,
) -> Option<i64> {
    let context_window = request.turn_context.and_then(|context| {
        context
            .metadata
            .get("lime_runtime")
            .and_then(|runtime| runtime.get("context_policy"))
            .and_then(|policy| policy.get("model_context_window"))
            .and_then(Value::as_i64)
            .or_else(|| {
                context
                    .metadata
                    .get("lime_runtime")
                    .and_then(|runtime| runtime.get("model_context_window"))
                    .and_then(Value::as_i64)
            })
    })?;
    let input_tokens = match pending_input {
        Some(input) => input.context_input_tokens().await,
        None => 0,
    };
    Some(context_window.saturating_sub(input_tokens.min(i64::MAX as u64) as i64))
}

#[cfg(test)]
mod sequential_exec_tests;

fn trusted_permission_turn_context(
    source: Option<&tool_runtime::tool_executor::RuntimeToolTurnContext>,
    grant: &EffectivePermissionGrant,
) -> Option<tool_runtime::tool_executor::RuntimeToolTurnContext> {
    let mut context = source.cloned();
    if let Some(context) = context.as_mut() {
        context.metadata.remove(GRANTED_PERMISSIONS_METADATA_KEY);
        context.metadata.remove(STRICT_AUTO_REVIEW_METADATA_KEY);
    }
    if grant.strict_auto_review {
        context
            .get_or_insert_with(Default::default)
            .metadata
            .insert(
                STRICT_AUTO_REVIEW_METADATA_KEY.to_string(),
                Value::Bool(true),
            );
    }
    context
}

fn mcp_tool_id(
    request: RuntimeToolExecutionRequest<'_>,
) -> Result<String, RuntimeToolExecutionError> {
    let identity = request
        .context
        .tool_identity()
        .ok_or_else(|| mcp_identity_error("tool identity"))?;
    mcp_identity_value(identity.call_id(), "call_id")
}

async fn await_mcp_call(
    event_sender: &UnboundedSender<AgentEvent>,
    tool_id: &str,
    route: &tool_runtime::mcp_connection::McpStepRouteIdentity,
    mut call: tool_runtime::mcp_connection::McpConnectionCall,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    let mut notifications_open = true;
    loop {
        tokio::select! {
            biased;
            notification = call.notifications.next(), if notifications_open => {
                match notification {
                    Some(notification) => {
                        emit_mcp_progress(event_sender, tool_id, route, notification)
                    }
                    None => notifications_open = false,
                }
            }
            result = &mut call.response => return project_call_result(result),
        }
    }
}

fn emit_mcp_progress(
    event_sender: &UnboundedSender<AgentEvent>,
    tool_id: &str,
    route: &tool_runtime::mcp_connection::McpStepRouteIdentity,
    notification: ServerNotification,
) {
    for projection in
        tool_runtime::mcp_notification::project_mcp_notification(tool_id, notification)
    {
        let tool_runtime::mcp_notification::McpNotificationProjection::ToolProgress {
            tool_id,
            progress,
        } = projection
        else {
            continue;
        };
        let Some(message) = progress
            .message
            .map(|message| message.trim().to_string())
            .filter(|message| !message.is_empty())
        else {
            continue;
        };
        let mut metadata = progress.metadata.unwrap_or_default();
        metadata.insert(
            "server_name".to_string(),
            Value::String(route.server_name.clone()),
        );
        metadata.insert(
            "tool_name".to_string(),
            Value::String(route.tool_name.clone()),
        );
        metadata.insert(
            "runtime_tool_name".to_string(),
            Value::String(route.runtime_tool_name.clone()),
        );
        let _ = event_sender.send(AgentEvent::ToolProgress {
            tool_id,
            progress: AgentToolProgressPayload {
                message: Some(message),
                progress: progress.progress,
                total: progress.total,
                metadata: Some(metadata),
            },
        });
    }
}

pub(super) fn mcp_call_scope(
    request: RuntimeToolExecutionRequest<'_>,
) -> Result<tool_runtime::mcp_connection::McpCallScope, RuntimeToolExecutionError> {
    let identity = request
        .context
        .tool_identity()
        .ok_or_else(|| mcp_identity_error("tool identity"))?;
    let turn_id = mcp_identity_value(identity.turn_id(), "turn_id")?;
    tool_runtime::mcp_connection::McpCallScope::new(Some(turn_id)).map_err(mcp_identity_error)
}

fn mcp_identity_value(value: &str, field: &str) -> Result<String, RuntimeToolExecutionError> {
    (!value.trim().is_empty())
        .then(|| value.to_string())
        .ok_or_else(|| mcp_identity_error(field))
}

fn mcp_identity_error(field: &str) -> RuntimeToolExecutionError {
    RuntimeToolExecutionError::new(
        format!("MCP call requires canonical {field}"),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
            "mcp_call_scope_missing".to_string(),
        )),
    )
}

pub(super) fn action_scope(
    request: RuntimeToolExecutionRequest<'_>,
    thread_id: &ThreadId,
) -> Result<
    (
        Option<agent_protocol::action_required::ActionRequiredScope>,
        String,
    ),
    RuntimeToolExecutionError,
> {
    let session_id = canonical_identity_value(request.context.session_id(), "session_id")?;
    let thread_id = canonical_identity_value(thread_id.as_str(), "thread_id")?;
    let identity = request
        .context
        .tool_identity()
        .ok_or_else(|| approval_identity_error("tool identity"))?;
    let turn_id = canonical_identity_value(identity.turn_id(), "turn_id")?;
    let tool_call_id = canonical_identity_value(identity.call_id(), "call_id")?;
    Ok((
        agent_protocol::action_required::ActionRequiredScope::from_parts(
            Some(session_id),
            Some(thread_id),
            Some(turn_id),
        ),
        tool_call_id,
    ))
}

fn canonical_identity_value(value: &str, field: &str) -> Result<String, RuntimeToolExecutionError> {
    (!value.trim().is_empty())
        .then(|| value.to_string())
        .ok_or_else(|| approval_identity_error(field))
}

fn approval_identity_error(field: &str) -> RuntimeToolExecutionError {
    RuntimeToolExecutionError::new(
        format!("tool approval requires canonical {field}"),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
            "tool_approval_identity_missing".to_string(),
        )),
    )
}

fn request_cancel_token(token: Option<&CancellationToken>) -> CancellationToken {
    token.cloned().unwrap_or_default()
}

fn project_mcp_error(error: ErrorData) -> RuntimeToolExecutionError {
    RuntimeToolExecutionError::new(
        error.message.to_string(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
            "mcp_dispatch".to_string(),
        )),
    )
}

pub(super) fn project_call_result(
    result: Result<CallToolResult, ErrorData>,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    let result = result.map_err(project_mcp_error)?;
    let mut metadata = HashMap::new();
    if let Some(meta) = result.meta.clone() {
        metadata.insert("meta".to_string(), Value::Object(meta.0));
    }
    if let Some(image) = result.content.iter().find_map(|content| content.as_image()) {
        metadata.insert("model_visible_image".into(), json!(true));
        metadata.insert(
            "image_url".into(),
            json!(format!("data:{};base64,{}", image.mime_type, image.data)),
        );
        metadata.insert("mime_type".into(), json!(image.mime_type));
    }
    let output = call_result_text(&result);
    let success = !result.is_error.unwrap_or(false);
    let error = (!success)
        .then(|| output.clone())
        .filter(|value| !value.is_empty());
    let projection = RuntimeToolExecutionResult::new(success, output, error, metadata);
    Ok(match result.structured_content {
        Some(content) => projection.with_structured_content(content),
        None => projection,
    })
}

fn project_runtime_dispatch_result(
    result: Result<CallToolResult, ErrorData>,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    result
        .map_err(project_runtime_dispatch_error)
        .and_then(|result| project_call_result(Ok(result)))
}

fn project_runtime_dispatch_error(error: ErrorData) -> RuntimeToolExecutionError {
    let handler_executed = error
        .data
        .as_ref()
        .and_then(|data| {
            data.get(tool_runtime::tool_result_projection::TOOL_HANDLER_EXECUTED_METADATA_KEY)
        })
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let error = project_mcp_error(error);
    if handler_executed {
        error
    } else {
        error.before_handler()
    }
}

fn call_result_text(result: &CallToolResult) -> String {
    let value = serde_json::to_value(result).unwrap_or(Value::Null);
    let mut text = Vec::new();
    collect_text_fields(&value, &mut text);
    if text.is_empty() {
        serde_json::to_string(&value).unwrap_or_default()
    } else {
        text.join("\n")
    }
}

fn collect_text_fields(value: &Value, target: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(text) = object.get("text").and_then(Value::as_str) {
                    target.push(text.to_string());
                    return;
                }
            }
            for value in object.values() {
                collect_text_fields(value, target);
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_text_fields(value, target);
            }
        }
        _ => {}
    }
}

fn request_user_input_is_blocking(
    turn_context: Option<&tool_runtime::tool_executor::RuntimeToolTurnContext>,
) -> bool {
    turn_context
        .and_then(|context| context.collaboration_mode.as_ref())
        .is_none_or(|mode| mode.mode == ModeKind::Plan)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod image_projection_tests;

#[cfg(test)]
mod async_user_input_tests;
