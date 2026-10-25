use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::*;
use std::path::Path;

impl RuntimeCore {
    /// Records Lime-style memory citation feedback after a completed assistant item.
    /// The citation is durable model output; usage writes are best-effort and never alter the
    /// current turn result when the auxiliary memory state is unavailable.
    pub(crate) async fn record_memory_citation_usage_for_event(
        &self,
        session_id: &str,
        event: &crate::RuntimeEvent,
    ) {
        if event.event_type != "message.completed" {
            return;
        }
        let Some(value) = event
            .payload
            .get("memoryCitation")
            .or_else(|| event.payload.get("memory_citation"))
        else {
            return;
        };
        let Some(citation) = crate::memory_store::parse_memory_citation(value) else {
            return;
        };
        let mut roots = vec![MemoryStoreRootParams {
            scope: MemoryStoreScope::Global,
            workspace_root: None,
        }];
        if let Ok((session, _)) = self.session_snapshot(session_id) {
            if let Some(workspace_root) = session_workspace_root(&session) {
                roots.push(MemoryStoreRootParams {
                    scope: MemoryStoreScope::Workspace,
                    workspace_root: Some(workspace_root),
                });
            }
        }
        for root in roots {
            if let Err(error) = self
                .app_data_source
                .record_memory_citation_usage(root, citation.clone())
                .await
            {
                tracing::debug!(session_id, %error, "memory citation usage feedback skipped");
            }
        }
    }

    /// Run Lime-style memory phase-1 using the session's current durable route.
    ///
    /// The route is resolved through the same backend admission path as a normal Turn so a
    /// model switch, credential rotation or provider readiness change is observed before any
    /// background sampling starts.
    pub async fn run_memory_stage1_for_session(
        &self,
        session_id: &str,
        root: MemoryStoreRootParams,
        version: crate::MemoryStageOneVersion,
    ) -> Result<crate::MemoryStageOneRunResult, RuntimeCoreError> {
        self.ensure_current_session_hydrated(session_id).await?;
        if !self.session_memory_generation_enabled(session_id) {
            return Err(RuntimeCoreError::Backend(
                "memory stage-1 is disabled for this session".to_string(),
            ));
        }
        let session = self.session_snapshot(session_id)?.0;
        let route = self.backend.resolve_memory_stage1_route(&session).await?;
        self.run_memory_stage1(root, version, route).await
    }

    pub async fn run_memory_stage2_for_session(
        &self,
        session_id: &str,
        root: MemoryStoreRootParams,
    ) -> Result<crate::MemoryStageOneRunResult, RuntimeCoreError> {
        self.ensure_current_session_hydrated(session_id).await?;
        if !self.session_memory_generation_enabled(session_id) {
            return Err(RuntimeCoreError::Backend(
                "memory stage-2 is disabled for this session".to_string(),
            ));
        }
        let session = self.session_snapshot(session_id)?.0;
        let route = self.backend.resolve_memory_stage1_route(&session).await?;
        self.app_data_source
            .run_memory_stage2(root, route, self)
            .await
    }

    /// Schedule the asynchronous startup extraction used by Codex root sessions.
    ///
    /// Provider readiness failures are logged and leave the durable source pending for a later
    /// startup; they never block `thread/start` or create a fallback model route.
    pub(crate) fn spawn_memory_stage1_startup(&self, session_id: String) {
        if !self.memory_startup_eligible(&session_id) {
            return;
        }
        let runtime = self.clone();
        tokio::spawn(async move {
            let stage1 = runtime
                .run_memory_stage1_for_session(
                    &session_id,
                    MemoryStoreRootParams::default(),
                    crate::MemoryStageOneVersion::V2,
                )
                .await;
            if let Err(error) = stage1 {
                tracing::debug!(session_id = %session_id, %error, "memory stage-1 startup skipped or failed");
                return;
            }
            if let Err(error) = runtime
                .run_memory_stage2_for_session(&session_id, MemoryStoreRootParams::default())
                .await
            {
                tracing::debug!(session_id = %session_id, %error, "memory stage-2 startup skipped or failed");
            }
        });
    }

    fn memory_startup_eligible(&self, session_id: &str) -> bool {
        let state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        let Some(session) = state.sessions.get(session_id) else {
            return false;
        };
        let Some(metadata) = session
            .session
            .business_object_ref
            .as_ref()
            .and_then(|reference| reference.metadata.as_ref())
        else {
            return false;
        };
        if metadata
            .get("ephemeral")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            return false;
        }
        if metadata
            .get("memoryMode")
            .or_else(|| metadata.get("memory_mode"))
            .and_then(serde_json::Value::as_str)
            .is_some_and(|mode| mode.eq_ignore_ascii_case("disabled"))
        {
            return false;
        }
        let source = metadata
            .get("threadSource")
            .or_else(|| metadata.get("thread_source"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        !source.contains("subagent") && !source.contains("agent")
    }

    pub async fn run_memory_stage1(
        &self,
        root: MemoryStoreRootParams,
        version: crate::MemoryStageOneVersion,
        route: crate::MemoryStageOneRoute,
    ) -> Result<crate::MemoryStageOneRunResult, RuntimeCoreError> {
        self.backend
            .run_memory_stage1(root, version, route, self.app_data_source.clone(), self)
            .await
    }

    pub async fn memory_status(
        &self,
        params: MemoryStatusParams,
    ) -> Result<MemoryStatusResponse, RuntimeCoreError> {
        self.app_data_source.memory_status(params).await
    }

    pub async fn read_project_memory(
        &self,
        params: ProjectMemoryReadParams,
    ) -> Result<ProjectMemoryReadResponse, RuntimeCoreError> {
        self.app_data_source.read_project_memory(params).await
    }

    pub async fn list_memory_store(
        &self,
        params: MemoryStoreListParams,
    ) -> Result<MemoryStoreListResponse, RuntimeCoreError> {
        self.app_data_source.list_memory_store(params).await
    }

    pub async fn read_memory_store(
        &self,
        params: MemoryStoreReadParams,
    ) -> Result<MemoryStoreReadResponse, RuntimeCoreError> {
        self.app_data_source.read_memory_store(params).await
    }

    pub async fn search_memory_store(
        &self,
        params: MemoryStoreSearchParams,
    ) -> Result<MemoryStoreSearchResponse, RuntimeCoreError> {
        self.app_data_source.search_memory_store(params).await
    }

    pub async fn add_memory_store_note(
        &self,
        params: MemoryStoreAddNoteParams,
    ) -> Result<MemoryStoreAddNoteResponse, RuntimeCoreError> {
        self.app_data_source.add_memory_store_note(params).await
    }

    pub async fn consolidate_memory_store(
        &self,
        params: MemoryStoreConsolidateParams,
    ) -> Result<MemoryStoreConsolidateResponse, RuntimeCoreError> {
        let session_id = params.session_id.trim().to_string();
        let session_id = if session_id.is_empty() {
            self.default_memory_session_id().ok_or_else(|| {
                RuntimeCoreError::Backend(
                    "memoryStore/consolidate requires an eligible root session".to_string(),
                )
            })?
        } else {
            session_id
        };
        self.ensure_current_session_hydrated(&session_id).await?;
        if !self.session_memory_generation_enabled(&session_id) {
            return Err(RuntimeCoreError::Backend(
                "memory consolidation is disabled for this session".to_string(),
            ));
        }
        let session = self.session_snapshot(&session_id)?.0;
        let route = self.backend.resolve_memory_stage1_route(&session).await?;
        self.app_data_source
            .consolidate_memory_store(params, route, self)
            .await
    }

    fn default_memory_session_id(&self) -> Option<String> {
        let state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        let session_ids = state.sessions.keys().cloned().collect::<Vec<_>>();
        drop(state);
        session_ids
            .into_iter()
            .find(|session_id| self.memory_startup_eligible(session_id))
    }

    pub async fn list_memory_store_review_notes(
        &self,
        params: MemoryStoreReviewListParams,
    ) -> Result<MemoryStoreReviewListResponse, RuntimeCoreError> {
        self.app_data_source
            .list_memory_store_review_notes(params)
            .await
    }

    pub async fn resolve_memory_store_review_note(
        &self,
        params: MemoryStoreReviewResolveParams,
    ) -> Result<MemoryStoreReviewResolveResponse, RuntimeCoreError> {
        self.app_data_source
            .resolve_memory_store_review_note(params)
            .await
    }

    pub async fn health_memory_store(
        &self,
        params: MemoryStoreRootParams,
    ) -> Result<MemoryStoreHealthResponse, RuntimeCoreError> {
        self.app_data_source.health_memory_store(params).await
    }

    pub async fn reset_memory(&self) -> Result<(), RuntimeCoreError> {
        self.app_data_source.reset_memory().await
    }

    pub async fn rebuild_memory_store_index(
        &self,
        params: MemoryStoreRootParams,
    ) -> Result<MemoryStoreIndexRebuildResponse, RuntimeCoreError> {
        self.app_data_source
            .rebuild_memory_store_index(params)
            .await
    }
}

fn session_workspace_root(session: &AgentSession) -> Option<String> {
    let metadata = session
        .business_object_ref
        .as_ref()
        .and_then(|reference| reference.metadata.as_ref())?;
    [
        "workspaceRoot",
        "workspace_root",
        "projectRoot",
        "project_root",
        "workingDir",
        "working_dir",
        "cwd",
    ]
    .into_iter()
    .find_map(|key| metadata.get(key).and_then(serde_json::Value::as_str))
    .map(str::trim)
    .filter(|value| !value.is_empty() && Path::new(value).is_absolute())
    .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use crate::{MockBackend, RuntimeCore};
    use app_server_protocol::{AgentSessionStartParams, BusinessObjectRef};
    use serde_json::json;
    use std::sync::Arc;

    fn core_with_metadata(metadata: serde_json::Value) -> RuntimeCore {
        let core = RuntimeCore::with_backend(Arc::new(MockBackend));
        core.start_session(AgentSessionStartParams {
            session_id: Some("memory-session".to_string()),
            thread_id: Some("memory-thread".to_string()),
            app_id: "agent-chat".to_string(),
            workspace_id: None,
            business_object_ref: Some(BusinessObjectRef {
                kind: "agent.thread".to_string(),
                id: "memory-thread".to_string(),
                title: None,
                uri: None,
                metadata: Some(metadata),
            }),
            locale: None,
        })
        .expect("start memory test session");
        core
    }

    #[test]
    fn startup_memory_requires_root_enabled_session() {
        let core = core_with_metadata(json!({
            "providerSelector": "fixture-provider",
            "modelName": "fixture-model"
        }));
        assert!(core.memory_startup_eligible("memory-session"));

        let disabled = core_with_metadata(json!({
            "providerSelector": "fixture-provider",
            "modelName": "fixture-model",
            "memoryMode": "disabled"
        }));
        assert!(!disabled.memory_startup_eligible("memory-session"));

        let subagent = core_with_metadata(json!({
            "providerSelector": "fixture-provider",
            "modelName": "fixture-model",
            "threadSource": "subagent"
        }));
        assert!(!subagent.memory_startup_eligible("memory-session"));
    }
}
