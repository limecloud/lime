use super::{RuntimeCore, RuntimeCoreError, RuntimeCoreState};
use crate::permission_profile::{
    apply_permission_profile_to_metadata, apply_resolved_permission_profile_to_metadata,
    permission_profile_policy, resolve_allowed_permission_profile, PermissionProfilePolicy,
    ResolvedPermissionProfile,
};
use agent_protocol::{CollaborationMode, CollaborationModeSettings, ModeKind};
use agent_runtime::session_loop::{
    RuntimeSessionHandler, RuntimeSessionOperation, RuntimeSessionOperationResult,
    RuntimeSessionOperationSubmission,
};
use app_server_protocol::protocol::v2::{
    ThreadMemoryMode, ThreadMemoryModeSetParams, ThreadMemoryModeSetResponse, ThreadSettings,
    ThreadSettingsUpdateParams,
};
use lime_core::config::ConfigManager;
use serde_json::{Map, Value};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tool_runtime::sandbox::SandboxBackendPlatform;

mod model_defaults;
mod settings;
mod working_directory;
pub(super) use settings::apply_thread_settings_patch;
#[cfg(test)]
use settings::persisted_collaboration_mode;
use settings::{thread_settings_from_metadata, validate_thread_settings};

#[derive(Clone)]
enum SessionMetadataMutation {
    ThreadSettings {
        params: ThreadSettingsUpdateParams,
        permission_profile: Option<ResolvedPermissionProfile>,
        workspace_roots: Option<Vec<String>>,
    },
    MemoryMode(ThreadMemoryMode),
    WorkingDirectory,
}

enum SessionMetadataMutationResult {
    ThreadSettings(ThreadSettings),
    MemoryMode,
    WorkingDirectory,
}

impl RuntimeCore {
    pub(crate) fn current_permission_profile_policy(
        &self,
        cwd: Option<&str>,
    ) -> Result<PermissionProfilePolicy, RuntimeCoreError> {
        let manager = ConfigManager::load(&self.app_config_path).map_err(|error| {
            RuntimeCoreError::Backend(format!(
                "failed to load permission profile policy config: {error}"
            ))
        })?;
        permission_profile_policy(manager.config(), cwd, SandboxBackendPlatform::current())
            .map_err(RuntimeCoreError::InvalidRequest)
    }

    pub(crate) fn resolve_allowed_permission_profile(
        &self,
        id: &str,
        cwd: Option<&str>,
    ) -> Result<ResolvedPermissionProfile, RuntimeCoreError> {
        let policy = self.current_permission_profile_policy(cwd)?;
        resolve_allowed_permission_profile(&policy, id).map_err(RuntimeCoreError::InvalidRequest)
    }

    pub(crate) async fn preflight_thread_start(
        &self,
        params: &app_server_protocol::AgentSessionStartParams,
    ) -> Result<(), RuntimeCoreError> {
        if !self.backend.requires_provider_selection() {
            return Ok(());
        }
        let session_id = normalized_identity(
            params.session_id.as_deref().unwrap_or_default(),
            "thread/start sessionId",
        )?;
        let thread_id = normalized_identity(
            params.thread_id.as_deref().unwrap_or_default(),
            "thread/start threadId",
        )?;
        let metadata = params
            .business_object_ref
            .as_ref()
            .and_then(|reference| reference.metadata.as_ref())
            .and_then(Value::as_object)
            .ok_or_else(|| {
                RuntimeCoreError::InvalidRequest(
                    "thread/start requires model route metadata".to_string(),
                )
            })?;
        let settings =
            thread_settings_from_metadata(metadata).map_err(RuntimeCoreError::InvalidRequest)?;
        let now = super::timestamp();
        let session = app_server_protocol::AgentSession {
            session_id,
            thread_id,
            app_id: params.app_id.clone(),
            workspace_id: params.workspace_id.clone(),
            business_object_ref: params.business_object_ref.clone(),
            status: app_server_protocol::AgentSessionStatus::Idle,
            created_at: now.clone(),
            updated_at: now,
        };
        let first_error = match self
            .backend
            .preflight_thread_settings(&session, &settings)
            .await
        {
            Ok(()) => return Ok(()),
            Err(error) => error,
        };
        let Some(provider_id) = missing_model_catalog_provider(&first_error) else {
            return Err(first_error);
        };

        let refresh = self.refresh_model_provider_catalog(&provider_id).await;
        match refresh {
            Ok(response) if response.source == "Api" => {}
            Ok(response) => {
                tracing::warn!(
                    provider_id,
                    source = response.source,
                    error_kind = response.error_kind.as_deref().unwrap_or("unknown"),
                    "thread start model catalog refresh did not produce API metadata"
                );
                return Err(first_error);
            }
            Err(_) => {
                tracing::warn!(
                    provider_id,
                    "thread start model catalog refresh failed; preserving pending route"
                );
                return Err(first_error);
            }
        }

        self.backend
            .preflight_thread_settings(&session, &settings)
            .await
    }

    pub(in crate::runtime) fn session_memory_enabled(&self, session_id: &str) -> bool {
        if !self.memory_config().is_some_and(|config| config.enabled) {
            return false;
        }
        let state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        state
            .sessions
            .get(session_id)
            .and_then(|stored| stored.session.business_object_ref.as_ref())
            .and_then(|reference| reference.metadata.as_ref())
            .and_then(|metadata| {
                metadata
                    .get("memoryMode")
                    .or_else(|| metadata.get("memory_mode"))
            })
            .and_then(Value::as_str)
            != Some("disabled")
    }

    pub async fn update_thread_settings(
        &self,
        params: ThreadSettingsUpdateParams,
    ) -> Result<ThreadSettings, RuntimeCoreError> {
        self.update_thread_context(params, None).await
    }

    pub(crate) async fn update_thread_context(
        &self,
        mut params: ThreadSettingsUpdateParams,
        workspace_roots: Option<Vec<String>>,
    ) -> Result<ThreadSettings, RuntimeCoreError> {
        validate_thread_settings(&params, workspace_roots.is_some())?;
        let workspace_roots = Self::resolve_workspace_roots(workspace_roots.as_deref())?;
        let permission_profile = params
            .permissions
            .as_deref()
            .map(|profile_id| {
                self.resolve_allowed_permission_profile(profile_id, params.cwd.as_deref())
            })
            .transpose()?;
        self.apply_target_model_defaults(&mut params).await?;
        let thread_id = params.thread_id.clone();
        let result = self
            .dispatch_session_metadata_mutation(
                &thread_id,
                SessionMetadataMutation::ThreadSettings {
                    params,
                    permission_profile,
                    workspace_roots,
                },
            )
            .await?;
        match result {
            SessionMetadataMutationResult::ThreadSettings(settings) => Ok(settings),
            SessionMetadataMutationResult::MemoryMode
            | SessionMetadataMutationResult::WorkingDirectory => Err(RuntimeCoreError::Backend(
                "thread settings operation returned an invalid result".to_string(),
            )),
        }
    }

    pub(crate) fn loaded_thread_settings(
        &self,
        thread_id: &str,
    ) -> Result<Option<(String, ThreadSettings, bool)>, RuntimeCoreError> {
        let state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        let stored = state
            .sessions
            .values()
            .find(|stored| stored.session.thread_id == thread_id)
            .ok_or_else(|| RuntimeCoreError::SessionNotFound(thread_id.to_string()))?;
        let Some(metadata) = stored
            .session
            .business_object_ref
            .as_ref()
            .and_then(|reference| reference.metadata.as_ref())
            .and_then(Value::as_object)
        else {
            return Ok(None);
        };
        if metadata_string(metadata, &["modelName", "model"]).is_none()
            || metadata_string(
                metadata,
                &["providerSelector", "providerName", "modelProvider"],
            )
            .is_none()
        {
            return Ok(None);
        }
        let settings =
            thread_settings_from_metadata(metadata).map_err(RuntimeCoreError::Backend)?;
        Ok(Some((
            stored.session.session_id.clone(),
            settings,
            super::agent_control::session_metadata_has_agent_control_route(metadata),
        )))
    }

    pub async fn set_thread_memory_mode(
        &self,
        params: ThreadMemoryModeSetParams,
    ) -> Result<ThreadMemoryModeSetResponse, RuntimeCoreError> {
        let thread_id = normalized_identity(&params.thread_id, "thread/memoryMode/set threadId")?;
        let result = self
            .dispatch_session_metadata_mutation(
                &thread_id,
                SessionMetadataMutation::MemoryMode(params.mode),
            )
            .await?;
        match result {
            SessionMetadataMutationResult::MemoryMode => Ok(ThreadMemoryModeSetResponse {}),
            SessionMetadataMutationResult::ThreadSettings(_)
            | SessionMetadataMutationResult::WorkingDirectory => Err(RuntimeCoreError::Backend(
                "memory mode operation returned an invalid result".to_string(),
            )),
        }
    }

    async fn dispatch_session_metadata_mutation(
        &self,
        thread_id: &str,
        mutation: SessionMetadataMutation,
    ) -> Result<SessionMetadataMutationResult, RuntimeCoreError> {
        let thread_id = normalized_identity(thread_id, "threadId")?;
        let thread = self
            .read_thread(agent_protocol::thread::ThreadReadParams {
                thread_id: agent_protocol::ThreadId::new(thread_id.clone()),
                turns_view: agent_protocol::ThreadTurnsView::NotLoaded,
            })
            .await?;
        if thread.thread.archived {
            return Err(RuntimeCoreError::InvalidRequest(format!(
                "thread is archived: {thread_id}"
            )));
        }
        let session_id = thread.thread.session_id.as_str().to_string();
        self.ensure_current_session_hydrated(&session_id).await?;

        let state = Arc::clone(&self.state);
        let backend = Arc::clone(&self.backend);
        let projection_store = self.projection_store.clone().ok_or_else(|| {
            RuntimeCoreError::Backend(
                "session metadata persistence requires the projection store".to_string(),
            )
        })?;
        let result = Arc::new(Mutex::new(None));
        let preflight_error = Arc::new(Mutex::new(None));
        let handler_result = Arc::clone(&result);
        let handler_preflight_error = Arc::clone(&preflight_error);
        let handler_session_id = session_id.clone();
        let handler_thread_id = thread_id.clone();
        let handler_mutation = mutation.clone();
        let handler = RuntimeSessionHandler::new(move |context| {
            let state = Arc::clone(&state);
            let projection_store = Arc::clone(&projection_store);
            let result = Arc::clone(&handler_result);
            let session_id = handler_session_id.clone();
            let thread_id = handler_thread_id.clone();
            let mutation = handler_mutation.clone();
            let backend = Arc::clone(&backend);
            let preflight_error = Arc::clone(&handler_preflight_error);
            Box::pin(async move {
                if context.session_id != session_id {
                    return Err("session actor identity changed during metadata update".to_string());
                }
                if let SessionMetadataMutation::ThreadSettings {
                    params,
                    permission_profile,
                    workspace_roots,
                } = &mutation
                {
                    if thread_settings_require_route_preflight(params) {
                        let (candidate_session, candidate_settings) =
                            preview_thread_settings_mutation(
                                &state,
                                &session_id,
                                &thread_id,
                                params.clone(),
                                permission_profile.clone(),
                                workspace_roots.clone(),
                            )?;
                        if let Err(error) = backend
                            .preflight_thread_settings(&candidate_session, &candidate_settings)
                            .await
                        {
                            let message = error.to_string();
                            *preflight_error.lock().map_err(|_| {
                                "thread settings preflight error lock poisoned".to_string()
                            })? = Some(error);
                            return Err(message);
                        }
                    }
                }
                let mutation_result = apply_session_metadata_mutation(
                    &state,
                    projection_store.as_ref(),
                    &session_id,
                    &thread_id,
                    mutation,
                )?;
                *result
                    .lock()
                    .map_err(|_| "session metadata result lock poisoned".to_string())? =
                    Some(mutation_result);
                Ok(())
            })
        });
        let operation = match mutation {
            SessionMetadataMutation::ThreadSettings { .. }
            | SessionMetadataMutation::WorkingDirectory => {
                RuntimeSessionOperation::ThreadSettings { handler }
            }
            SessionMetadataMutation::MemoryMode(_) => {
                RuntimeSessionOperation::SetMemoryMode { handler }
            }
        };
        let session = self
            .session_loops
            .get_or_create(&session_id, &thread_id)
            .await
            .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
        let dispatch_result = match session
            .dispatch(RuntimeSessionOperationSubmission::new(operation))
            .await
        {
            Ok(result) => result,
            Err(error) => {
                if let Some(error) = preflight_error
                    .lock()
                    .map_err(|_| {
                        RuntimeCoreError::Backend(
                            "thread settings preflight error lock poisoned".to_string(),
                        )
                    })?
                    .take()
                {
                    return Err(error);
                }
                return Err(RuntimeCoreError::Backend(error.to_string()));
            }
        };
        if !matches!(
            dispatch_result,
            RuntimeSessionOperationResult::Accepted { .. }
        ) {
            return Err(RuntimeCoreError::Backend(
                "session metadata operation was not accepted".to_string(),
            ));
        }
        let mut result = result.lock().map_err(|_| {
            RuntimeCoreError::Backend("session metadata result lock poisoned".into())
        })?;
        result.take().ok_or_else(|| {
            RuntimeCoreError::Backend(
                "session metadata operation completed without a result".to_string(),
            )
        })
    }
}

fn preview_thread_settings_mutation(
    state: &Arc<Mutex<RuntimeCoreState>>,
    session_id: &str,
    thread_id: &str,
    params: ThreadSettingsUpdateParams,
    permission_profile: Option<ResolvedPermissionProfile>,
    workspace_roots: Option<Vec<String>>,
) -> Result<(app_server_protocol::AgentSession, ThreadSettings), String> {
    let state = state
        .lock()
        .map_err(|_| "runtime core state lock poisoned".to_string())?;
    let stored = state
        .sessions
        .get(session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;
    if stored.session.thread_id != thread_id {
        return Err(format!(
            "session/thread identity mismatch for thread {thread_id}"
        ));
    }

    let mut candidate_session = stored.session.clone();
    let metadata = candidate_session
        .business_object_ref
        .as_ref()
        .and_then(|reference| reference.metadata.clone())
        .unwrap_or_else(|| Value::Object(Default::default()));
    let mut metadata = metadata
        .as_object()
        .cloned()
        .ok_or_else(|| "thread metadata must be a JSON object".to_string())?;
    apply_thread_context_patch(&mut metadata, params, permission_profile, workspace_roots)?;
    let settings = thread_settings_from_metadata(&metadata)?;
    let reference = candidate_session
        .business_object_ref
        .get_or_insert_with(|| app_server_protocol::BusinessObjectRef {
            kind: "agent.thread".to_string(),
            id: thread_id.to_string(),
            title: None,
            uri: None,
            metadata: None,
        });
    reference.metadata = Some(Value::Object(metadata));
    Ok((candidate_session, settings))
}

fn thread_settings_require_route_preflight(params: &ThreadSettingsUpdateParams) -> bool {
    params.model.is_some()
        || params.model_provider.is_some()
        || params.service_tier.is_some()
        || params.effort.is_some()
        || params.collaboration_mode.is_some()
}

fn apply_session_metadata_mutation(
    state: &Arc<Mutex<RuntimeCoreState>>,
    projection_store: &super::ProjectionStore,
    session_id: &str,
    thread_id: &str,
    mutation: SessionMetadataMutation,
) -> Result<SessionMetadataMutationResult, String> {
    let mut state = state
        .lock()
        .map_err(|_| "runtime core state lock poisoned".to_string())?;
    let stored = state
        .sessions
        .get_mut(session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;
    if stored.session.thread_id != thread_id {
        return Err(format!(
            "session/thread identity mismatch for thread {thread_id}"
        ));
    }

    let mut updated_session = stored.session.clone();
    let metadata = updated_session
        .business_object_ref
        .as_ref()
        .and_then(|reference| reference.metadata.clone())
        .unwrap_or_else(|| Value::Object(Default::default()));
    let mut metadata = metadata
        .as_object()
        .cloned()
        .ok_or_else(|| "thread metadata must be a JSON object".to_string())?;
    let result = match mutation {
        SessionMetadataMutation::ThreadSettings {
            params,
            permission_profile,
            workspace_roots,
        } => {
            apply_thread_context_patch(&mut metadata, params, permission_profile, workspace_roots)?;
            SessionMetadataMutationResult::ThreadSettings(thread_settings_from_metadata(&metadata)?)
        }
        SessionMetadataMutation::MemoryMode(mode) => {
            metadata.insert(
                "memoryMode".to_string(),
                Value::String(mode.as_str().to_string()),
            );
            SessionMetadataMutationResult::MemoryMode
        }
        SessionMetadataMutation::WorkingDirectory => {
            if !RuntimeCore::normalize_thread_working_directory_metadata(&mut metadata)
                .map_err(|error| error.to_string())?
            {
                return Ok(SessionMetadataMutationResult::WorkingDirectory);
            }
            SessionMetadataMutationResult::WorkingDirectory
        }
    };
    let reference = updated_session.business_object_ref.get_or_insert_with(|| {
        app_server_protocol::BusinessObjectRef {
            kind: "agent.thread".to_string(),
            id: thread_id.to_string(),
            title: None,
            uri: None,
            metadata: None,
        }
    });
    reference.metadata = Some(Value::Object(metadata));
    updated_session.updated_at = super::timestamp();

    projection_store.persist_session_metadata(&mut updated_session)?;
    stored.session = updated_session;
    Ok(result)
}

fn apply_thread_context_patch(
    metadata: &mut Map<String, Value>,
    params: ThreadSettingsUpdateParams,
    permission_profile: Option<ResolvedPermissionProfile>,
    workspace_roots: Option<Vec<String>>,
) -> Result<(), String> {
    apply_thread_settings_patch(metadata, params, permission_profile)?;
    if let Some(roots) = workspace_roots {
        metadata.insert(
            "runtimeWorkspaceRoots".to_string(),
            serde_json::json!(roots),
        );
    }
    Ok(())
}

fn normalized_identity(value: &str, field: &str) -> Result<String, RuntimeCoreError> {
    normalized_value(value, field).map(str::to_string)
}

fn missing_model_catalog_provider(error: &RuntimeCoreError) -> Option<String> {
    match error {
        RuntimeCoreError::PendingRoute {
            provider: Some(provider),
            reason_code,
            ..
        } if reason_code == "model_registry_metadata_missing" => {
            let provider = provider.trim();
            (!provider.is_empty()).then(|| provider.to_string())
        }
        _ => None,
    }
}

fn normalized_value<'a>(value: &'a str, field: &str) -> Result<&'a str, RuntimeCoreError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(RuntimeCoreError::InvalidRequest(format!(
            "{field} must not be empty"
        )));
    }
    Ok(value)
}

fn validate_optional_string(value: Option<&str>, field: &str) -> Result<(), RuntimeCoreError> {
    if let Some(value) = value {
        normalized_value(value, field)?;
    }
    Ok(())
}

fn validate_setting_value(value: &Value, field: &str) -> Result<(), RuntimeCoreError> {
    if value.is_null() || value.as_str().is_some_and(|value| value.trim().is_empty()) {
        return Err(RuntimeCoreError::InvalidRequest(format!(
            "thread/settings/update {field} must not be empty"
        )));
    }
    Ok(())
}

fn insert_string(metadata: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), Value::String(value));
    }
}

fn insert_value(metadata: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), value);
    }
}

fn metadata_alias(metadata: &Map<String, Value>, keys: &[&str]) -> Option<Value> {
    keys.iter().find_map(|key| metadata.get(*key)).cloned()
}

fn metadata_value(metadata: &Map<String, Value>, keys: &[&str]) -> Value {
    metadata_alias(metadata, keys).unwrap_or(Value::Null)
}

fn metadata_string(metadata: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| metadata.get(*key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
#[path = "session_operations/tests.rs"]
mod tests;
