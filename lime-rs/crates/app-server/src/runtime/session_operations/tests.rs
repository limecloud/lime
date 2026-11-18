use super::*;
use async_trait::async_trait;
use serde_json::json;

struct RejectingModelSwitchBackend;

#[tokio::test]
async fn unchanged_memory_mode_does_not_rewrite_session_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let store = Arc::new(
        crate::ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap(),
    );
    let core = RuntimeCore::with_backend(Arc::new(RejectingModelSwitchBackend))
        .with_projection_store(store.clone());
    core.start_session(app_server_protocol::AgentSessionStartParams {
        session_id: Some("session-noop".into()),
        thread_id: Some("thread-noop".into()),
        app_id: "agent-chat".into(),
        workspace_id: None,
        business_object_ref: Some(app_server_protocol::BusinessObjectRef {
            kind: "agent.thread".into(),
            id: "thread-noop".into(),
            title: None,
            uri: None,
            metadata: Some(json!({"memoryMode": "enabled"})),
        }),
        locale: None,
    })
    .unwrap();
    let before = {
        let mut state = core.state.lock().unwrap();
        let session = &mut state.sessions.get_mut("session-noop").unwrap().session;
        session.updated_at = "2026-01-01T00:00:00Z".into();
        session.clone()
    };
    apply_session_metadata_mutation(
        &core.state,
        &store,
        "session-noop",
        "thread-noop",
        SessionMetadataMutation::MemoryMode(ThreadMemoryMode::Enabled),
    )
    .unwrap();
    let state = core.state.lock().unwrap();
    assert_eq!(state.sessions["session-noop"].session, before);
}

#[async_trait]
impl crate::ExecutionBackend for RejectingModelSwitchBackend {
    async fn preflight_thread_settings(
        &self,
        session: &app_server_protocol::AgentSession,
        settings: &ThreadSettings,
    ) -> Result<(), RuntimeCoreError> {
        Err(RuntimeCoreError::RouteRejected {
            session_id: session.session_id.clone(),
            provider: Some(settings.model_provider.clone()),
            model: Some(settings.model.clone()),
            category: app_server_protocol::RouteFailureCategory::ModelUnavailable,
            reason_code: "model_registry_metadata_missing".to_string(),
        })
    }

    async fn start_turn(
        &self,
        _request: crate::ExecutionRequest,
        _sink: &mut dyn crate::RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    async fn cancel_turn(
        &self,
        _request: crate::CancelExecutionRequest,
        _sink: &mut dyn crate::RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    async fn respond_action(
        &self,
        _request: crate::ActionRespondRequest,
        _sink: &mut dyn crate::RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }
}

#[tokio::test]
async fn rejected_route_settings_do_not_persist_candidate_settings() {
    let temp = tempfile::TempDir::new().expect("thread settings temp dir");
    let store = Arc::new(
        crate::ProjectionStore::initialize(temp.path().join("projection.sqlite"))
            .expect("thread settings projection store"),
    );
    let core = RuntimeCore::with_backend(Arc::new(RejectingModelSwitchBackend))
        .with_projection_store(store);
    core.start_session(app_server_protocol::AgentSessionStartParams {
        session_id: Some("session-settings-preflight".to_string()),
        thread_id: Some("thread-settings-preflight".to_string()),
        app_id: "agent-chat".to_string(),
        workspace_id: None,
        business_object_ref: Some(app_server_protocol::BusinessObjectRef {
            kind: "agent.thread".to_string(),
            id: "thread-settings-preflight".to_string(),
            title: None,
            uri: None,
            metadata: Some(json!({
                "providerSelector": "provider-a",
                "providerName": "provider-a",
                "modelName": "model-a"
            })),
        }),
        locale: None,
    })
    .expect("start settings preflight session");

    let tier_error = core
        .update_thread_settings(ThreadSettingsUpdateParams {
            thread_id: "thread-settings-preflight".to_string(),
            service_tier: Some(Some("unsupported-tier".to_string())),
            ..ThreadSettingsUpdateParams::default()
        })
        .await
        .expect_err("service tier update must be preflighted");
    assert!(matches!(
        tier_error,
        RuntimeCoreError::RouteRejected {
            reason_code,
            ..
        } if reason_code == "model_registry_metadata_missing"
    ));
    {
        let state = core
            .state
            .lock()
            .expect("runtime state after tier rejection");
        let metadata = state.sessions["session-settings-preflight"]
            .session
            .business_object_ref
            .as_ref()
            .and_then(|reference| reference.metadata.as_ref())
            .expect("persisted metadata after tier rejection");
        assert!(metadata.get("serviceTier").is_none());
    }

    let error = core
        .update_thread_settings(ThreadSettingsUpdateParams {
            thread_id: "thread-settings-preflight".to_string(),
            model: Some("missing-model".to_string()),
            model_provider: Some("provider-b".to_string()),
            ..ThreadSettingsUpdateParams::default()
        })
        .await
        .expect_err("model switch must be rejected");

    assert!(matches!(
        error,
        RuntimeCoreError::RouteRejected {
            reason_code,
            ..
        } if reason_code == "model_registry_metadata_missing"
    ));
    let state = core.state.lock().expect("runtime state");
    let metadata = state.sessions["session-settings-preflight"]
        .session
        .business_object_ref
        .as_ref()
        .and_then(|reference| reference.metadata.as_ref())
        .expect("persisted metadata");
    assert_eq!(metadata["providerSelector"], "provider-a");
    assert_eq!(metadata["providerName"], "provider-a");
    assert_eq!(metadata["modelName"], "model-a");
}

#[test]
fn plain_model_and_effort_updates_refresh_the_active_collaboration_mode() {
    let mut metadata = json!({
        "modelName": "model-a",
        "providerSelector": "provider-a",
        "reasoningEffort": "low",
        "collaborationMode": {
            "mode": "plan",
            "settings": {
                "model": "model-a",
                "reasoning_effort": "low",
                "developer_instructions": "Keep the existing plan instructions."
            }
        },
        "agentControlRoute": {
            "schemaVersion": 2,
            "providerPreference": "provider-a",
            "modelPreference": "model-a"
        }
    })
    .as_object()
    .expect("metadata object")
    .clone();

    apply_thread_settings_patch(
        &mut metadata,
        ThreadSettingsUpdateParams {
            thread_id: "thread-1".to_string(),
            model: Some("model-b".to_string()),
            model_provider: Some("provider-b".to_string()),
            effort: Some("high".to_string()),
            ..ThreadSettingsUpdateParams::default()
        },
        None,
    )
    .expect("update metadata");

    let mode = persisted_collaboration_mode(&metadata)
        .expect("valid mode")
        .expect("persisted mode");
    assert_eq!(mode.mode, ModeKind::Plan);
    assert_eq!(mode.settings.model, "model-b");
    assert_eq!(mode.settings.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(metadata["providerSelector"], "provider-b");
    assert_eq!(metadata["providerName"], "provider-b");
    assert!(metadata.get("agentControlRoute").is_none());
    assert_eq!(
        mode.settings.developer_instructions.as_deref(),
        Some("Keep the existing plan instructions.")
    );
}

#[test]
fn model_only_update_clears_effort_owned_by_the_previous_model() {
    let mut metadata = json!({
        "modelName": "reasoning-model",
        "providerSelector": "provider-a",
        "reasoningEffort": "high",
        "serviceTier": "priority",
        "collaborationMode": {
            "mode": "default",
            "settings": {
                "model": "reasoning-model",
                "reasoning_effort": "high"
            }
        }
    })
    .as_object()
    .expect("metadata object")
    .clone();

    apply_thread_settings_patch(
        &mut metadata,
        ThreadSettingsUpdateParams {
            thread_id: "thread-1".to_string(),
            model: Some("plain-model".to_string()),
            model_provider: Some("provider-b".to_string()),
            ..ThreadSettingsUpdateParams::default()
        },
        None,
    )
    .expect("update metadata");

    let settings = thread_settings_from_metadata(&metadata).expect("thread settings");
    assert_eq!(settings.model, "plain-model");
    assert_eq!(settings.model_provider, "provider-b");
    assert_eq!(settings.effort, None);
    assert_eq!(settings.service_tier, None);
    assert_eq!(settings.collaboration_mode.settings.reasoning_effort, None);
}
