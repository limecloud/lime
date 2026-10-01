//! v2 turn command handlers.

mod input;
pub(super) use input::validate_v2_input_limit;

use super::{
    dispatch_result, parse_params, to_jsonrpc_error,
    v2_notifications::{project_events, V2NotificationProjector},
    RequestProcessor, RpcDispatch,
};
use crate::processor::config_warning::ConfigWarningScope;
use agent_protocol::{AgentInput, ThreadId, ThreadTurnsView};
use app_server_protocol::protocol::v2::{
    AdditionalContextKind, ServerNotification as V2ServerNotification,
    ThreadSettingsUpdatedNotification, Turn as V2Turn, TurnInterruptParams, TurnInterruptResponse,
    TurnStartParams, TurnStartResponse, TurnStatus as V2TurnStatus, TurnSteerParams,
    TurnSteerResponse, UserInput,
};
use app_server_protocol::{
    error_codes, AgentSessionTurnCancelParams, AgentSessionTurnStartResponse, AgentTurn,
    AgentTurnStatus, JsonRpcError, JsonRpcMessage, JsonRpcNotification, RuntimeOptions,
    RuntimeRequest, ThreadReadParams,
};
use serde_json::{Map, Value};

use crate::permission_profile::{
    apply_resolved_permission_profile_to_metadata,
    resolve_permission_profile as resolve_builtin_permission_profile,
    resolve_permission_profile_for_request, PermissionProfilePolicy,
};

const DIRECT_INPUT_TO_PARENT_OWNED_THREAD_ERROR: &str =
    "direct app-server input is not allowed for parent-owned threads";

impl RequestProcessor {
    /// v2 `turn/start` boundary. The runtime still owns execution; this
    /// adapter only resolves the canonical thread identity and lowers the
    /// typed v2 request into the current RuntimeCore request.
    pub(super) async fn handle_turn_start_v2_impl(
        &self,
        params: Option<Value>,
        event_callback: Option<&mut (dyn FnMut(JsonRpcMessage) + Send)>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let mut params: TurnStartParams = parse_params(params)?;
        self.ensure_direct_input_allowed(&params.thread_id).await?;
        validate_v2_input_limit(&params.input)?;
        params.environments = self
            .resolve_turn_environment_selections(&params.thread_id, params.environments.take())
            .await?;
        self.ensure_environment_execution_lowering(params.environments.as_deref())?;
        let session_id = self.resolve_loaded_v2_thread_session(&params.thread_id)?;
        if let Some(profile_id) = params.permissions.as_deref() {
            self.resolve_allowed_permission_profile(profile_id, params.cwd.as_deref())?;
        }
        self.record_environment_selections(&params.thread_id, params.environments.as_deref());
        self.append_environment_world_state(&session_id, params.environments.as_deref())
            .map_err(to_jsonrpc_error)?;
        let environment_world_state = self
            .environment_world_state_snapshot(params.environments.as_deref())
            .await;
        let permission_policy = self
            .runtime
            .current_permission_profile_policy(params.cwd.as_deref())
            .map_err(to_jsonrpc_error)?;
        let mut runtime_params =
            lower_turn_start_params_with_policy(&params, session_id, Some(&permission_policy))?;
        if !environment_world_state.is_empty() {
            insert_runtime_metadata(
                &mut runtime_params,
                "environmentWorldState",
                serde_json::to_value(environment_world_state).map_err(|error| {
                    invalid_params(format!("invalid Environment world-state snapshot: {error}"))
                })?,
            );
        }
        let host = self.runtime_host_context();
        let mut notifications: Vec<JsonRpcNotification> = Vec::new();
        if let Some(thread_settings) = self
            .runtime
            .reconcile_thread_model_selection(&params.thread_id)
            .await
            .map_err(to_jsonrpc_error)?
        {
            notifications.push(
                V2ServerNotification::ThreadSettingsUpdated(ThreadSettingsUpdatedNotification {
                    thread_id: params.thread_id.clone(),
                    thread_settings,
                })
                .into(),
            );
        }
        notifications.extend(self.config_warning_notifications(ConfigWarningScope::TurnStart));

        let _ = event_callback;
        let output = self
            .runtime
            .start_turn_admitted(runtime_params, host)
            .await
            .map_err(to_jsonrpc_error)?;
        let response = v2_start_response(output.response);
        let environment_notifications = self
            .environment_selection_notifications(&params.thread_id, params.environments.as_deref())
            .await;
        notifications.extend(environment_notifications);
        Ok(dispatch_result(response)?.with_notifications(notifications))
    }

    /// v2 `turn/interrupt` boundary. The thread lookup is deliberately
    /// canonical so callers cannot smuggle an unrelated session id.
    pub(super) async fn handle_turn_interrupt_v2_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: TurnInterruptParams = parse_params(params)?;
        let session_id = self.resolve_loaded_v2_thread_session(&params.thread_id)?;
        let turn_id = non_empty_param(&params.turn_id, "turnId")?;
        self.runtime
            .ensure_turn_interruptible(&session_id, &turn_id)
            .map_err(|error| map_interrupt_runtime_error(error, &params))?;
        self.abort_server_requests_for_turn(params.thread_id.clone(), turn_id.clone())
            .await;
        let output = self
            .runtime
            .cancel_turn(
                AgentSessionTurnCancelParams {
                    session_id,
                    turn_id,
                },
                self.runtime_host_context(),
            )
            .await
            .map_err(|error| map_interrupt_runtime_error(error, &params))?;
        let mut notification_projector = V2NotificationProjector::default();
        let notifications = project_events(&mut notification_projector, output.events)?;
        Ok(dispatch_result(TurnInterruptResponse {})?.with_notifications(notifications))
    }

    pub(super) fn resolve_loaded_v2_thread_session(
        &self,
        thread_id: &str,
    ) -> Result<String, JsonRpcError> {
        let thread_id = non_empty_param(thread_id, "threadId")?;
        self.runtime
            .loaded_session_id_for_thread(&thread_id)
            .ok_or_else(|| invalid_request(format!("thread not found: {thread_id}")))
    }

    pub(super) async fn resolve_persisted_v2_thread_session(
        &self,
        thread_id: &str,
    ) -> Result<String, JsonRpcError> {
        let thread_id = non_empty_param(thread_id, "threadId")?;
        let response = self
            .runtime
            .read_thread(ThreadReadParams {
                thread_id: ThreadId::from(thread_id),
                turns_view: ThreadTurnsView::NotLoaded,
            })
            .await
            .map_err(to_jsonrpc_error)?;
        Ok(response.thread.session_id.to_string())
    }

    pub(super) async fn ensure_direct_input_allowed(
        &self,
        thread_id: &str,
    ) -> Result<(), JsonRpcError> {
        let allowed = self
            .runtime
            .can_accept_direct_input(thread_id)
            .await
            .map_err(to_jsonrpc_error)?;
        if !allowed {
            return Err(invalid_request(DIRECT_INPUT_TO_PARENT_OWNED_THREAD_ERROR));
        }
        Ok(())
    }
}

fn lower_turn_start_params_with_policy(
    params: &TurnStartParams,
    session_id: String,
    permission_policy: Option<&PermissionProfilePolicy>,
) -> Result<crate::runtime::TurnStartRequest, JsonRpcError> {
    Ok(crate::runtime::TurnStartRequest {
        session_id,
        turn_id: None,
        input: lower_user_input(params.input.clone())?,
        runtime_options: lower_runtime_options_with_policy(params, permission_policy)?,
        queue_if_busy: false,
        skip_pre_submit_resume: false,
    })
}

fn lower_runtime_options_with_policy(
    params: &TurnStartParams,
    permission_policy: Option<&PermissionProfilePolicy>,
) -> Result<Option<RuntimeOptions>, JsonRpcError> {
    if params.permissions.is_some() && params.sandbox_policy.is_some() {
        return Err(invalid_params(
            "permissions cannot be combined with sandboxPolicy",
        ));
    }
    let mut options = RuntimeOptions {
        output_schema: params.output_schema.clone(),
        ..RuntimeOptions::default()
    };
    let mut request = RuntimeRequest {
        collaboration_mode: params.collaboration_mode.clone(),
        ..RuntimeRequest::default()
    };
    let mut metadata = Map::new();

    if let Some(mode) = params.collaboration_mode.as_ref() {
        let model = mode.settings.model.trim();
        if model.is_empty() {
            return Err(invalid_params(
                "collaborationMode.settings.model must not be empty",
            ));
        }
        request.model_preference = Some(model.to_string());
        request.reasoning_effort = mode.settings.reasoning_effort.clone();
        request.system_prompt = mode.settings.developer_instructions.clone();
    } else {
        if let Some(model) = params
            .model
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            request.model_preference = Some(model.to_string());
        }
        if let Some(effort) = params
            .effort
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            request.reasoning_effort = Some(effort.to_string());
        }
    }
    if let Some(cwd) = params
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        request.working_dir = Some(cwd.to_string());
    }
    if let Some(root) = params
        .runtime_workspace_roots
        .as_ref()
        .and_then(|roots| roots.first())
        .map(String::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        request.workspace_root = Some(root.to_string());
    }
    if let Some(policy) = params.approval_policy.as_ref() {
        if let Some(policy) = policy.as_str().map(str::trim).filter(|v| !v.is_empty()) {
            request.approval_policy = Some(policy.to_string());
        } else {
            metadata.insert("approvalPolicy".to_string(), policy.clone());
        }
    }
    if let Some(policy) = params.sandbox_policy.as_ref() {
        if let Some(policy) = policy.as_str().map(str::trim).filter(|v| !v.is_empty()) {
            request.sandbox_policy = Some(policy.to_string());
        } else {
            metadata.insert("sandboxPolicy".to_string(), policy.clone());
        }
    }
    let requested_profile = params.permissions.as_deref();
    let selected_profile = match permission_policy {
        Some(policy) => resolve_permission_profile_for_request(policy, requested_profile)
            .map_err(invalid_params)?,
        None => requested_profile
            .map(|value| resolve_builtin_permission_profile(value).map_err(invalid_params))
            .transpose()?,
    };
    if let Some(profile) = selected_profile {
        if params.sandbox_policy.is_some() {
            return Err(invalid_params(
                "permissions cannot be combined with sandboxPolicy",
            ));
        }
        request.sandbox_policy = Some(profile.sandbox_policy.clone());
        apply_resolved_permission_profile_to_metadata(&mut metadata, profile)
            .map_err(invalid_params)?;
    }
    if let Some(value) = params
        .client_user_message_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        metadata.insert(
            "clientUserMessageId".to_string(),
            Value::String(value.to_string()),
        );
    }
    if let Some(value) = params.responsesapi_client_metadata.as_ref() {
        metadata.insert(
            "responsesapiClientMetadata".to_string(),
            serde_json::to_value(value).map_err(|error| {
                invalid_params(format!("invalid responsesapiClientMetadata: {error}"))
            })?,
        );
    }
    if let Some(value) = params.additional_context.as_ref() {
        lower_application_metadata(value, &mut metadata);
        metadata.insert(
            "additionalContext".to_string(),
            serde_json::to_value(value)
                .map_err(|error| invalid_params(format!("invalid additionalContext: {error}")))?,
        );
    }
    if let Some(value) = params.environments.as_ref() {
        metadata.insert(
            "environments".to_string(),
            serde_json::to_value(value)
                .map_err(|error| invalid_params(format!("invalid environments: {error}")))?,
        );
    }
    if let Some(value) = params.service_tier.as_ref() {
        metadata.insert(
            "serviceTier".to_string(),
            serde_json::to_value(value)
                .map_err(|error| invalid_params(format!("invalid serviceTier: {error}")))?,
        );
    }
    for (key, value) in [
        ("summary", params.summary.clone().map(Value::String)),
        ("personality", params.personality.clone()),
    ] {
        if let Some(value) = value {
            metadata.insert(key.to_string(), value);
        }
    }
    if !metadata.is_empty() {
        request.metadata = Some(Value::Object(metadata));
    }
    if request != RuntimeRequest::default() {
        options.runtime_request = Some(request);
    }
    if options.output_schema.is_some() || options.runtime_request.is_some() {
        Ok(Some(options))
    } else {
        Ok(None)
    }
}

fn insert_runtime_metadata(params: &mut crate::runtime::TurnStartRequest, key: &str, value: Value) {
    let options = params
        .runtime_options
        .get_or_insert_with(RuntimeOptions::default);
    let metadata = options
        .runtime_metadata_mut()
        .get_or_insert_with(|| Value::Object(Map::new()));
    if !metadata.is_object() {
        *metadata = Value::Object(Map::new());
    }
    metadata
        .as_object_mut()
        .expect("runtime metadata object")
        .insert(key.to_string(), value);
}

fn lower_application_metadata(
    additional_context: &std::collections::HashMap<
        String,
        app_server_protocol::protocol::v2::AdditionalContextEntry,
    >,
    metadata: &mut Map<String, Value>,
) {
    let Some(entry) = additional_context.get("metadata") else {
        return;
    };
    if entry.kind != AdditionalContextKind::Application {
        return;
    }
    let Ok(Value::Object(application_metadata)) = serde_json::from_str(&entry.value) else {
        return;
    };
    for (key, value) in application_metadata {
        metadata.entry(key).or_insert(value);
    }
}

fn v2_start_response(response: AgentSessionTurnStartResponse) -> TurnStartResponse {
    TurnStartResponse {
        turn: v2_turn_from_agent_turn(response.turn),
    }
}

pub(super) fn v2_turn_from_agent_turn(turn: AgentTurn) -> V2Turn {
    let status = match turn.status {
        AgentTurnStatus::Completed => V2TurnStatus::Completed,
        AgentTurnStatus::Canceled => V2TurnStatus::Interrupted,
        AgentTurnStatus::Failed => V2TurnStatus::Failed,
        AgentTurnStatus::Accepted
        | AgentTurnStatus::Queued
        | AgentTurnStatus::Running
        | AgentTurnStatus::WaitingAction => V2TurnStatus::InProgress,
    };
    let started_at_ms = turn.started_at.as_deref().and_then(timestamp_millis);
    let completed_at_ms = turn.completed_at.as_deref().and_then(timestamp_millis);
    let duration_ms = started_at_ms
        .zip(completed_at_ms)
        .map(|(started, completed)| completed.saturating_sub(started));
    V2Turn {
        id: turn.turn_id,
        items: Vec::new(),
        items_view: app_server_protocol::protocol::v2::TurnItemsView::NotLoaded,
        status,
        error: None,
        started_at: started_at_ms.map(|value| value.div_euclid(1_000)),
        completed_at: completed_at_ms.map(|value| value.div_euclid(1_000)),
        duration_ms,
    }
}

fn timestamp_millis(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.timestamp_millis())
}

fn non_empty_param(value: &str, field: &str) -> Result<String, JsonRpcError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(invalid_params(format!("turn request requires {field}")));
    }
    Ok(value.to_string())
}

impl RequestProcessor {
    pub(super) async fn handle_turn_steer_impl(
        &self,
        params: Option<Value>,
        event_callback: Option<&mut (dyn FnMut(JsonRpcMessage) + Send)>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: TurnSteerParams = parse_params(params)?;
        reject_unsupported_map(
            "responsesapiClientMetadata",
            params.responsesapi_client_metadata.as_ref(),
        )?;
        reject_unsupported_map("additionalContext", params.additional_context.as_ref())?;
        self.resolve_loaded_v2_thread_session(&params.thread_id)?;
        self.ensure_direct_input_allowed(&params.thread_id).await?;
        let input = lower_user_input(params.input.clone())?;
        let output = self
            .runtime
            .steer_turn(
                &params.thread_id,
                &params.expected_turn_id,
                input,
                params.client_user_message_id.clone(),
            )
            .await
            .map_err(|error| map_steer_runtime_error(error, &params))?;

        let response = TurnSteerResponse {
            turn_id: output.response,
        };
        let mut notification_projector = V2NotificationProjector::default();
        if let Some(event_callback) = event_callback {
            for event in output.events {
                for notification in notification_projector.project(event)? {
                    event_callback(JsonRpcMessage::Notification(notification));
                }
            }
            dispatch_result(response)
        } else {
            let notifications = project_events(&mut notification_projector, output.events)?;
            Ok(dispatch_result(response)?.with_notifications(notifications))
        }
    }
}

fn map_steer_runtime_error(
    error: crate::RuntimeCoreError,
    params: &TurnSteerParams,
) -> JsonRpcError {
    match error {
        crate::RuntimeCoreError::TurnNotActive(_) => invalid_request(format!(
            "expected active turn id `{}` is no longer active",
            params.expected_turn_id
        )),
        crate::RuntimeCoreError::SessionNotFound(_) => {
            invalid_request(format!("thread not found: {}", params.thread_id.trim()))
        }
        crate::RuntimeCoreError::InvalidRequest(message) => invalid_request(message),
        other => to_jsonrpc_error(other),
    }
}

fn map_interrupt_runtime_error(
    error: crate::RuntimeCoreError,
    params: &TurnInterruptParams,
) -> JsonRpcError {
    match error {
        crate::RuntimeCoreError::TurnNotActive(_) => invalid_request("no active turn to interrupt"),
        crate::RuntimeCoreError::SessionNotFound(_) => {
            invalid_request(format!("thread not found: {}", params.thread_id.trim()))
        }
        crate::RuntimeCoreError::InvalidRequest(message) => invalid_request(message),
        other => to_jsonrpc_error(other),
    }
}

fn lower_user_input(items: Vec<UserInput>) -> Result<Vec<AgentInput>, JsonRpcError> {
    validate_v2_input_limit(&items)?;
    if items.is_empty() {
        return Err(invalid_params("turn/steer input must not be empty"));
    }

    let input = items
        .into_iter()
        .map(UserInput::into_core)
        .collect::<Vec<_>>();
    for part in &input {
        part.validate()
            .map_err(|error| invalid_params(error.to_string()))?;
    }
    if input.iter().all(|part| {
        matches!(
            part,
            AgentInput::Text { text, .. } if text.trim().is_empty()
        )
    }) {
        return Err(invalid_params("turn/steer input must not be empty"));
    }
    Ok(input)
}

fn reject_unsupported_map<K, V>(
    field: &str,
    value: Option<&std::collections::HashMap<K, V>>,
) -> Result<(), JsonRpcError> {
    if value.is_some_and(|value| !value.is_empty()) {
        return Err(invalid_params(format!(
            "turn/steer {field} is not supported by the current runtime boundary"
        )));
    }
    Ok(())
}

fn invalid_params(message: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(error_codes::INVALID_PARAMS, message)
}

fn invalid_request(message: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(error_codes::INVALID_REQUEST, message)
}

#[cfg(test)]
#[path = "turn/tests.rs"]
mod tests;
