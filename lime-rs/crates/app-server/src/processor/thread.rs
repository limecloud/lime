mod dynamic_tools;
mod guardian;
mod inject_items;
mod lifecycle;
mod output_defaults;
pub(super) mod projection;

use super::v2_notifications::{project_events, V2NotificationProjector};
use super::{
    dispatch_result, parse_params, to_jsonrpc_error, ConnectionRequestId, RequestProcessor,
    RpcDispatch,
};
use crate::permission_profile::{
    apply_resolved_permission_profile_to_metadata, resolve_permission_profile_for_request,
};
use app_server_protocol::protocol::v2::{
    ServerNotification, SortDirection, Thread, ThreadArchiveParams, ThreadArchiveResponse,
    ThreadArchivedNotification, ThreadCompactStartParams, ThreadDecrementElicitationParams,
    ThreadDecrementElicitationResponse, ThreadDeleteParams, ThreadDeleteResponse,
    ThreadDeletedNotification, ThreadHistoryMode, ThreadIncrementElicitationParams,
    ThreadIncrementElicitationResponse, ThreadItem, ThreadItemsListParams, ThreadListParams,
    ThreadLoadedListParams, ThreadMetadataUpdateParams, ThreadMetadataUpdateResponse,
    ThreadNameUpdatedNotification, ThreadProjectUpdatedNotification, ThreadReadParams,
    ThreadResumeParams, ThreadResumeResponse, ThreadRevertParams, ThreadRevertResponse,
    ThreadRevertedNotification, ThreadSearchOccurrencesParams, ThreadSearchParams,
    ThreadSetNameParams, ThreadStartParams, ThreadStartResponse, ThreadStatus,
    ThreadTurnsListParams, ThreadUnarchiveParams, ThreadUnarchiveResponse,
    ThreadUnarchivedNotification, ThreadUnsubscribeParams, ThreadUnsubscribeResponse,
    ThreadUnsubscribeStatus, Turn, TurnItemsView, TurnStatus, TurnsPage,
};
use app_server_protocol::{
    error_codes, AgentSessionStartParams, AgentSessionTurnCancelParams, BusinessObjectRef,
    JsonRpcError, JsonRpcNotification,
};
use dynamic_tools::validate_dynamic_tools;
use projection::{
    lower_thread_items_list_params, lower_thread_list_params, lower_thread_read_params,
    lower_thread_search_params, lower_thread_turns_list_params, project_thread_items_list_response,
    project_thread_list_response, project_thread_read_response, project_thread_search_response,
    project_thread_turns_list_response,
};
use serde_json::json;
use uuid::Uuid;

pub(super) enum ProjectedEvent {
    Thread(Thread),
    Turn(Turn),
    Item(ThreadItem),
}

pub(super) fn project_event(event: &app_server_protocol::AgentEvent) -> Option<ProjectedEvent> {
    projection::project_event(event)
}

impl RequestProcessor {
    pub(super) async fn handle_thread_loaded_list_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadLoadedListParams = parse_params(params)?;
        let response = self
            .runtime
            .list_loaded_threads(params)
            .map_err(|error| match error {
                crate::RuntimeCoreError::InvalidRequest(message) => invalid_request(message),
                other => to_jsonrpc_error(other),
            })?;
        dispatch_result(response)
    }

    pub(super) async fn handle_thread_unsubscribe_v2(
        &self,
        params: Option<serde_json::Value>,
        connection_request_id: Option<ConnectionRequestId>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadUnsubscribeParams = parse_params(params)?;
        let thread_id = required_thread_value(&params.thread_id, "thread/unsubscribe")?;
        Uuid::parse_str(&thread_id)
            .map_err(|error| invalid_request(format!("invalid thread id: {error}")))?;
        let connection_id = connection_request_id
            .ok_or_else(|| invalid_request("thread/unsubscribe requires transport context"))?
            .connection_id;
        let thread_id = agent_protocol::ThreadId::new(thread_id);

        if self
            .runtime
            .loaded_session_id_for_thread(thread_id.as_str())
            .is_none()
        {
            self.close_mcp_event_streams_for_thread(thread_id.as_str())
                .await;
            self.forget_environment_selections(thread_id.as_str());
            self.thread_states.remove_thread(&thread_id).await;
            self.request_worktree_cleanup().await;
            return dispatch_result(ThreadUnsubscribeResponse {
                status: ThreadUnsubscribeStatus::NotLoaded,
            });
        }

        let status = if self
            .thread_states
            .unsubscribe_connection(&thread_id, connection_id)
            .await
        {
            ThreadUnsubscribeStatus::Unsubscribed
        } else {
            ThreadUnsubscribeStatus::NotSubscribed
        };
        self.request_worktree_cleanup().await;
        dispatch_result(ThreadUnsubscribeResponse { status })
    }

    pub(super) async fn handle_thread_increment_elicitation_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadIncrementElicitationParams = parse_params(params)?;
        let thread_id = required_thread_value(&params.thread_id, "thread/increment_elicitation")?;
        Uuid::parse_str(&thread_id)
            .map_err(|error| invalid_request(format!("invalid thread id: {error}")))?;
        let count = self
            .runtime
            .increment_thread_elicitation(&thread_id)
            .map_err(to_jsonrpc_error)?;
        dispatch_result(ThreadIncrementElicitationResponse {
            count,
            paused: count > 0,
        })
    }

    pub(super) async fn handle_thread_decrement_elicitation_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadDecrementElicitationParams = parse_params(params)?;
        let thread_id = required_thread_value(&params.thread_id, "thread/decrement_elicitation")?;
        Uuid::parse_str(&thread_id)
            .map_err(|error| invalid_request(format!("invalid thread id: {error}")))?;
        let count = self
            .runtime
            .decrement_thread_elicitation(&thread_id)
            .map_err(to_jsonrpc_error)?;
        dispatch_result(ThreadDecrementElicitationResponse {
            count,
            paused: count > 0,
        })
    }

    pub(super) async fn handle_thread_name_set_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadSetNameParams = parse_params(params)?;
        let thread_id = required_thread_value(&params.thread_id, "thread/name/set")?;
        let thread_name = params.name.trim().to_string();
        let response = self
            .runtime
            .set_thread_name(ThreadSetNameParams {
                thread_id: thread_id.clone(),
                name: thread_name.clone(),
            })
            .await
            .map_err(to_jsonrpc_error)?;
        let notification: JsonRpcNotification =
            ServerNotification::ThreadNameUpdated(ThreadNameUpdatedNotification {
                thread_id,
                thread_name: Some(thread_name),
            })
            .into();
        Ok(dispatch_result(response)?.with_notification(notification))
    }

    pub(super) async fn handle_thread_metadata_update_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let mut params: ThreadMetadataUpdateParams = parse_params(params)?;
        params.thread_id = required_thread_value(&params.thread_id, "thread/metadata/update")?;
        Uuid::parse_str(&params.thread_id)
            .map_err(|error| invalid_request(format!("invalid thread id: {error}")))?;
        if params.project_id.is_none() && params.git_info.is_none() {
            return Err(invalid_request(
                "thread metadata update must include at least one field",
            ));
        }
        let previous_project_id = if params.project_id.is_some() {
            let current = self
                .runtime
                .read_thread(agent_protocol::thread::ThreadReadParams {
                    thread_id: agent_protocol::ThreadId::new(params.thread_id.clone()),
                    turns_view: agent_protocol::ThreadTurnsView::NotLoaded,
                })
                .await
                .map_err(to_jsonrpc_error)?;
            metadata_optional_string(&current.thread.metadata, "projectId")
        } else {
            None
        };
        let next_project_id = match params.project_id.as_deref() {
            Some("") => Some(None),
            Some(project_id) => {
                self.ensure_project_exists(project_id, "thread/metadata/update")
                    .await?;
                Some(Some(project_id.to_string()))
            }
            None => None,
        };
        if let Some(git_info) = params.git_info.as_mut() {
            if git_info.sha.is_none() && git_info.branch.is_none() && git_info.origin_url.is_none()
            {
                return Err(invalid_request("gitInfo must include at least one field"));
            }
            normalize_git_field(&mut git_info.sha, "gitInfo.sha")?;
            normalize_git_field(&mut git_info.branch, "gitInfo.branch")?;
            normalize_git_field(&mut git_info.origin_url, "gitInfo.originUrl")?;
        }
        let thread_id = params.thread_id.clone();
        let thread = self
            .runtime
            .update_thread_metadata(params)
            .await
            .map_err(to_jsonrpc_error)?;
        let thread =
            project_thread_read_response(agent_protocol::thread::ThreadReadResponse { thread })?
                .thread;
        if let Some(project_id) = next_project_id {
            if previous_project_id != project_id {
                self.publish_server_notification(ServerNotification::ThreadProjectUpdated(
                    ThreadProjectUpdatedNotification {
                        thread_id,
                        project_id,
                    },
                ))
                .await;
            }
        }
        dispatch_result(ThreadMetadataUpdateResponse { thread })
    }

    pub(super) async fn handle_thread_compact_start_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadCompactStartParams = parse_params(params)?;
        self.ensure_direct_input_allowed(&params.thread_id).await?;
        let output = self
            .runtime
            .compact_thread(params)
            .await
            .map_err(|error| match error {
                crate::RuntimeCoreError::InvalidRequest(message) => invalid_request(message),
                other => to_jsonrpc_error(other),
            })?;
        debug_assert!(output.events.is_empty());
        dispatch_result(output.response)
    }

    pub(super) async fn handle_thread_delete_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadDeleteParams = parse_params(params)?;
        let thread_id = required_thread_value(&params.thread_id, "thread/delete")?;
        let deleted = self
            .runtime
            .delete_thread(agent_protocol::ThreadId::new(thread_id.clone()), None)
            .await
            .map_err(to_jsonrpc_error)?;
        let notifications = self.finish_thread_delete(deleted).await;
        Ok(dispatch_result(ThreadDeleteResponse {})?.with_notifications(notifications))
    }

    pub(super) async fn finish_thread_delete(
        &self,
        deleted: Vec<crate::runtime::DeletedThread>,
    ) -> Vec<JsonRpcNotification> {
        for deleted_thread in &deleted {
            self.close_mcp_event_streams_for_thread(&deleted_thread.thread_id)
                .await;
            self.forget_environment_selections(&deleted_thread.thread_id);
        }
        deleted
            .into_iter()
            .map(|thread| {
                let notification: JsonRpcNotification =
                    ServerNotification::ThreadDeleted(ThreadDeletedNotification {
                        thread_id: thread.thread_id,
                    })
                    .into();
                notification
            })
            .collect()
    }

    pub(super) async fn handle_thread_archive_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadArchiveParams = parse_params(params)?;
        let thread_id = required_thread_value(&params.thread_id, "thread/archive")?;
        let changed = self
            .runtime
            .archive_thread(agent_protocol::ThreadId::new(thread_id.clone()))
            .await
            .map_err(to_jsonrpc_error)?;
        let dispatch = dispatch_result(ThreadArchiveResponse {})?;
        if !changed {
            return Ok(dispatch);
        }
        let notification = self.finish_thread_archive(thread_id).await;
        Ok(dispatch.with_notification(notification.into()))
    }

    pub(super) async fn finish_thread_archive(&self, thread_id: String) -> ServerNotification {
        self.close_mcp_event_streams_for_thread(&thread_id).await;
        self.forget_environment_selections(&thread_id);
        ServerNotification::ThreadArchived(ThreadArchivedNotification { thread_id })
    }

    pub(super) async fn handle_thread_unarchive_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadUnarchiveParams = parse_params(params)?;
        let thread_id = required_thread_value(&params.thread_id, "thread/unarchive")?;
        let thread = self
            .runtime
            .unarchive_thread(agent_protocol::ThreadId::new(thread_id.clone()))
            .await
            .map_err(to_jsonrpc_error)?;
        let thread =
            project_thread_read_response(agent_protocol::thread::ThreadReadResponse { thread })?
                .thread;
        let metadata = thread.extra.clone().unwrap_or(serde_json::Value::Null);
        let environments = super::turn_environment::persisted_environment_selections(&metadata)?;
        let environments = self.normalize_environment_selections(environments).await?;
        self.record_environment_selections(&thread_id, environments.as_deref());
        let dispatch = dispatch_result(ThreadUnarchiveResponse { thread })?;
        let notification: JsonRpcNotification =
            ServerNotification::ThreadUnarchived(ThreadUnarchivedNotification {
                thread_id: thread_id.clone(),
            })
            .into();
        Ok(dispatch.with_notification(notification).with_notifications(
            self.environment_selection_notifications(&thread_id, environments.as_deref())
                .await,
        ))
    }

    pub(super) async fn handle_thread_revert_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadRevertParams = parse_params(params)?;
        let thread_id = required_thread_value(&params.thread_id, "thread/revert")?;
        let before_turn_id = required_non_empty(&params.before_turn_id, "beforeTurnId")?;
        self.ensure_direct_input_allowed(&thread_id).await?;

        // Revert has the same cancellation contract as turn/interrupt. Resume first so a
        // cold thread is hydrated and the runtime snapshot is authoritative.
        let resumed = self
            .runtime
            .resume_thread(agent_protocol::ThreadId::new(thread_id.clone()))
            .await
            .map_err(to_jsonrpc_error)?;
        let mut notifications = Vec::new();
        if let Some(active_turn_id) = resumed.active_turn_id {
            let session_id = resumed.thread.session_id.to_string();
            let turn_id = active_turn_id.as_str().to_string();
            self.runtime
                .ensure_turn_interruptible(&session_id, &turn_id)
                .map_err(to_jsonrpc_error)?;
            self.abort_server_requests_for_turn(thread_id.clone(), turn_id.clone())
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
                .map_err(to_jsonrpc_error)?;
            let mut projector = V2NotificationProjector::default();
            notifications.extend(project_events(&mut projector, output.events)?);
        }

        let reverted = self
            .runtime
            .revert_thread_history(
                agent_protocol::ThreadId::new(thread_id.clone()),
                agent_protocol::TurnId::new(before_turn_id),
            )
            .await
            .map_err(to_jsonrpc_error)?;
        let mut thread =
            project_thread_read_response(agent_protocol::thread::ThreadReadResponse {
                thread: reverted.thread,
            })?
            .thread;
        thread.turns.clear();
        notifications.push(
            ServerNotification::ThreadReverted(ThreadRevertedNotification { thread_id }).into(),
        );
        Ok(dispatch_result(ThreadRevertResponse {
            thread,
            turns_backwards_cursor: reverted
                .turns_backwards_cursor
                .map(thread_store::StoreCursor::into_string),
            items_backwards_cursor: reverted
                .items_backwards_cursor
                .map(thread_store::StoreCursor::into_string),
        })?
        .with_notifications(notifications))
    }

    pub(super) async fn handle_thread_read_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadReadParams = parse_params(params)?;
        let response = self
            .runtime
            .read_thread(lower_thread_read_params(&params)?)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(project_thread_read_response(response)?)
    }

    pub(super) async fn handle_thread_list_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadListParams = parse_params(params)?;
        if let Some(Some(project_id)) = params.project_id.as_ref() {
            self.ensure_project_exists(project_id, "thread/list")
                .await?;
        }
        let response = self
            .runtime
            .list_threads(lower_thread_list_params(&params)?)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(project_thread_list_response(response, &params)?)
    }

    pub(super) async fn handle_thread_turns_list_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadTurnsListParams = parse_params(params)?;
        let response = self
            .runtime
            .list_thread_turns(lower_thread_turns_list_params(&params)?)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(project_thread_turns_list_response(response)?)
    }

    pub(super) async fn handle_thread_items_list_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadItemsListParams = parse_params(params)?;
        let response = self
            .runtime
            .list_thread_items(lower_thread_items_list_params(&params)?)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(project_thread_items_list_response(response)?)
    }

    pub(super) async fn handle_thread_search_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadSearchParams = parse_params(params)?;
        if params.search_term.trim().is_empty() {
            return Err(invalid_request(
                "thread/search requires a non-empty searchTerm",
            ));
        }
        let response = self
            .runtime
            .search_threads(lower_thread_search_params(&params)?)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(project_thread_search_response(response)?)
    }

    pub(super) async fn handle_thread_search_occurrences_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadSearchOccurrencesParams = parse_params(params)?;
        let thread_id = required_thread_value(&params.thread_id, "thread/searchOccurrences")?;
        Uuid::parse_str(&thread_id)
            .map_err(|error| invalid_request(format!("invalid thread id: {error}")))?;
        let response = self
            .runtime
            .search_thread_occurrences(ThreadSearchOccurrencesParams {
                thread_id,
                ..params
            })
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }
}

fn normalize_thread_resume_snapshot(thread: &mut Thread, active_turn_id: Option<&str>) {
    let active_flags = match &thread.status {
        ThreadStatus::Active { active_flags } => active_flags.clone(),
        _ => Vec::new(),
    };
    thread.status = match active_turn_id {
        Some(_) => ThreadStatus::Active { active_flags },
        None if matches!(thread.status, ThreadStatus::SystemError) => ThreadStatus::SystemError,
        None => ThreadStatus::Idle,
    };
    normalize_resume_turns(&mut thread.turns, active_turn_id);
}

fn normalize_resume_turns(turns: &mut [Turn], active_turn_id: Option<&str>) {
    for turn in turns {
        if active_turn_id == Some(turn.id.as_str()) {
            turn.status = TurnStatus::InProgress;
        } else if matches!(turn.status, TurnStatus::InProgress) {
            turn.status = TurnStatus::Interrupted;
        }
    }
}

fn required_thread_value(value: &str, method: &str) -> Result<String, JsonRpcError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(JsonRpcError::new(
            error_codes::INVALID_PARAMS,
            format!("{method} requires a non-empty threadId"),
        ));
    }
    Ok(value.to_string())
}

fn required_non_empty(value: &str, field: &str) -> Result<String, JsonRpcError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(JsonRpcError::new(
            error_codes::INVALID_PARAMS,
            format!("{field} must not be empty"),
        ));
    }
    Ok(value.to_string())
}

fn normalize_git_field(field: &mut Option<Option<String>>, name: &str) -> Result<(), JsonRpcError> {
    if let Some(Some(value)) = field {
        let normalized = value.trim().to_string();
        if normalized.is_empty() {
            return Err(invalid_request(format!("{name} must not be empty")));
        }
        *value = normalized;
    }
    Ok(())
}

fn validate_thread_resume_params(params: &ThreadResumeParams) -> Result<(), JsonRpcError> {
    required_thread_resume_value(&params.thread_id, "threadId")?;
    if params.permissions.is_some() && params.sandbox.is_some() {
        return Err(invalid_request(
            "thread/resume cannot specify both permissions and sandbox",
        ));
    }
    if let Some(history) = params.history.as_ref() {
        if history.is_empty() {
            return Err(invalid_request(
                "thread/resume history must contain at least one item",
            ));
        }
        return Err(invalid_request(
            "thread/resume history is not implemented by the current runtime boundary",
        ));
    }
    if params
        .path
        .as_deref()
        .is_some_and(|path| !path.trim().is_empty())
    {
        return Err(invalid_request(
            "thread/resume path is not implemented by the current runtime boundary",
        ));
    }

    let unsupported = [
        (params.model.is_some(), "model"),
        (params.model_provider.is_some(), "modelProvider"),
        (params.service_tier.is_some(), "serviceTier"),
        (params.cwd.is_some(), "cwd"),
        (
            params.runtime_workspace_roots.is_some(),
            "runtimeWorkspaceRoots",
        ),
        (params.approval_policy.is_some(), "approvalPolicy"),
        (params.approvals_reviewer.is_some(), "approvalsReviewer"),
        (params.sandbox.is_some(), "sandbox"),
        (params.permissions.is_some(), "permissions"),
        (params.config.is_some(), "config"),
        (params.base_instructions.is_some(), "baseInstructions"),
        (
            params.developer_instructions.is_some(),
            "developerInstructions",
        ),
        (params.personality.is_some(), "personality"),
    ];
    if let Some((_, field)) = unsupported.into_iter().find(|(present, _)| *present) {
        return Err(invalid_request(format!(
            "thread/resume {field} override is not implemented by the current runtime boundary"
        )));
    }
    Ok(())
}

fn required_thread_resume_value(value: &str, field: &str) -> Result<String, JsonRpcError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(JsonRpcError::new(
            error_codes::INVALID_PARAMS,
            format!("thread/resume requires a non-empty {field}"),
        ));
    }
    Ok(value.to_string())
}

fn required_metadata_string(
    metadata: &serde_json::Value,
    keys: &[&str],
    field: &str,
) -> Result<String, JsonRpcError> {
    keys.iter()
        .find_map(|key| metadata_optional_string(metadata, key))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            invalid_request(format!(
                "thread/resume persisted thread is missing a non-empty {field}"
            ))
        })
}

fn invalid_request(message: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(error_codes::INVALID_REQUEST, message)
}

fn invalid_params(message: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(error_codes::INVALID_PARAMS, message)
}

fn metadata_optional_string(metadata: &serde_json::Value, key: &str) -> Option<String> {
    metadata
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
}

fn metadata_string_array(metadata: &serde_json::Value, key: &str) -> Vec<String> {
    metadata
        .get(key)
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(ToString::to_string)
        .collect()
}

fn metadata_value(metadata: &serde_json::Value, key: &str) -> serde_json::Value {
    metadata
        .get(key)
        .cloned()
        .unwrap_or(serde_json::Value::Null)
}

#[cfg(test)]
mod tests;
