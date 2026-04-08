use anyhow::{anyhow, Result};
use std::sync::{Arc, OnceLock};

use super::runtime_store::{
    require_shared_thread_runtime_store, QueuedTurnRuntime, SessionExecutionGate,
    ThreadRuntimeStore,
};

static SHARED_SESSION_RUNTIME_QUEUE_SERVICE: OnceLock<Arc<SessionRuntimeQueueService>> =
    OnceLock::new();
const SHARED_SESSION_RUNTIME_QUEUE_SERVICE_INIT_ERROR: &str =
    "shared session runtime queue service is not initialized; call initialize_shared_thread_runtime_store first";

#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeQueueSubmitResult {
    StartNow,
    Busy,
    Enqueued {
        queued_turn: Box<QueuedTurnRuntime>,
        position: usize,
    },
}

#[derive(Clone)]
pub struct SessionRuntimeQueueService {
    store: Arc<dyn ThreadRuntimeStore>,
    execution_gate: SessionExecutionGate,
}

impl SessionRuntimeQueueService {
    pub fn new(store: Arc<dyn ThreadRuntimeStore>) -> Self {
        Self::with_gate(store, SessionExecutionGate::default())
    }

    pub fn with_gate(
        store: Arc<dyn ThreadRuntimeStore>,
        execution_gate: SessionExecutionGate,
    ) -> Self {
        Self {
            store,
            execution_gate,
        }
    }

    pub fn has_active_turn(&self, session_id: &str) -> bool {
        self.execution_gate.is_active(session_id)
    }

    async fn take_next_turn_with_gate(
        &self,
        session_id: &str,
        acquire_gate: bool,
    ) -> Result<Option<QueuedTurnRuntime>> {
        if acquire_gate && !self.execution_gate.try_start(session_id) {
            return Ok(None);
        }

        match self.store.take_next_queued_turn(session_id).await? {
            Some(queued_turn) => Ok(Some(queued_turn)),
            None => {
                self.execution_gate.finish(session_id);
                Ok(None)
            }
        }
    }

    pub async fn resume_if_idle(&self, session_id: &str) -> Result<Option<QueuedTurnRuntime>> {
        if self.has_active_turn(session_id) {
            return Ok(None);
        }

        self.take_next_turn_with_gate(session_id, true).await
    }

    pub async fn finish_turn_and_take_next(
        &self,
        session_id: &str,
    ) -> Result<Option<QueuedTurnRuntime>> {
        self.take_next_turn_with_gate(session_id, false).await
    }

    pub async fn submit_turn(
        &self,
        queued_turn: QueuedTurnRuntime,
        queue_if_busy: bool,
    ) -> Result<RuntimeQueueSubmitResult> {
        let session_id = queued_turn.session_id.clone();

        if !self.has_active_turn(&session_id) && self.execution_gate.try_start(&session_id) {
            return Ok(RuntimeQueueSubmitResult::StartNow);
        }

        if !queue_if_busy {
            return Ok(RuntimeQueueSubmitResult::Busy);
        }

        let persisted = self.store.enqueue_turn(queued_turn).await?;
        let queued_turns = self.store.list_queued_turns(&session_id).await?;
        let position = queued_turns
            .iter()
            .position(|existing| existing.queued_turn_id == persisted.queued_turn_id)
            .map(|index| index + 1)
            .unwrap_or(queued_turns.len());

        Ok(RuntimeQueueSubmitResult::Enqueued {
            queued_turn: Box::new(persisted),
            position,
        })
    }

    pub async fn list_queued_turns(&self, session_id: &str) -> Result<Vec<QueuedTurnRuntime>> {
        self.store.list_queued_turns(session_id).await
    }

    pub async fn list_queued_turn_session_ids(&self) -> Result<Vec<String>> {
        self.store.list_queued_turn_session_ids().await
    }

    pub async fn remove_queued_turn(
        &self,
        queued_turn_id: &str,
    ) -> Result<Option<QueuedTurnRuntime>> {
        self.store.remove_queued_turn(queued_turn_id).await
    }

    pub async fn clear_queued_turns(&self, session_id: &str) -> Result<Vec<QueuedTurnRuntime>> {
        self.store.clear_queued_turns(session_id).await
    }
}

pub(crate) fn initialize_shared_session_runtime_queue_service(
    store: Arc<dyn ThreadRuntimeStore>,
) -> Arc<SessionRuntimeQueueService> {
    let _ =
        SHARED_SESSION_RUNTIME_QUEUE_SERVICE.set(Arc::new(SessionRuntimeQueueService::new(store)));
    SHARED_SESSION_RUNTIME_QUEUE_SERVICE
        .get()
        .expect("shared runtime queue service should be initialized")
        .clone()
}

pub fn require_shared_session_runtime_queue_service() -> Result<Arc<SessionRuntimeQueueService>> {
    require_shared_thread_runtime_store()?;
    SHARED_SESSION_RUNTIME_QUEUE_SERVICE
        .get()
        .cloned()
        .ok_or_else(|| anyhow!(SHARED_SESSION_RUNTIME_QUEUE_SERVICE_INIT_ERROR))
}

#[cfg(test)]
mod tests {
    use super::{
        require_shared_session_runtime_queue_service, RuntimeQueueSubmitResult,
        SessionRuntimeQueueService,
    };
    use crate::session::{
        initialize_shared_thread_runtime_store, InMemoryThreadRuntimeStore, QueuedTurnRuntime,
        ThreadRuntimeStore,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn queued_turn(session_id: &str, queued_turn_id: &str, created_at: i64) -> QueuedTurnRuntime {
        QueuedTurnRuntime {
            queued_turn_id: queued_turn_id.to_string(),
            session_id: session_id.to_string(),
            message_preview: format!("preview-{queued_turn_id}"),
            message_text: format!("message-{queued_turn_id}"),
            created_at,
            image_count: 0,
            payload: json!({ "queuedTurnId": queued_turn_id }),
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn require_shared_session_runtime_queue_service_uses_initialized_store() {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));
        assert!(require_shared_session_runtime_queue_service().is_ok());
    }

    #[tokio::test]
    async fn resume_if_idle_starts_next_turn_and_marks_session_active() {
        let store = Arc::new(InMemoryThreadRuntimeStore::default());
        let service = SessionRuntimeQueueService::new(store.clone());
        let first = queued_turn("session-1", "queued-1", 1);
        store.enqueue_turn(first.clone()).await.unwrap();

        let resumed = service.resume_if_idle("session-1").await.unwrap();

        assert_eq!(resumed, Some(first));
        assert!(service.has_active_turn("session-1"));
    }

    #[tokio::test]
    async fn finish_turn_and_take_next_releases_gate_when_queue_is_empty() {
        let store = Arc::new(InMemoryThreadRuntimeStore::default());
        let service = SessionRuntimeQueueService::new(store.clone());
        store
            .enqueue_turn(queued_turn("session-1", "queued-1", 1))
            .await
            .unwrap();

        let _ = service.resume_if_idle("session-1").await.unwrap();
        let next = service
            .finish_turn_and_take_next("session-1")
            .await
            .unwrap();

        assert!(next.is_none());
        assert!(!service.has_active_turn("session-1"));
    }

    #[tokio::test]
    async fn submit_turn_starts_immediately_when_session_is_idle() {
        let store = Arc::new(InMemoryThreadRuntimeStore::default());
        let service = SessionRuntimeQueueService::new(store);

        let result = service
            .submit_turn(queued_turn("session-1", "queued-1", 1), true)
            .await
            .unwrap();

        assert_eq!(result, RuntimeQueueSubmitResult::StartNow);
        assert!(service.has_active_turn("session-1"));
    }

    #[tokio::test]
    async fn submit_turn_enqueues_and_reports_position_when_session_is_busy() {
        let store = Arc::new(InMemoryThreadRuntimeStore::default());
        let service = SessionRuntimeQueueService::new(store.clone());
        let _ = service
            .submit_turn(queued_turn("session-1", "running", 1), true)
            .await
            .unwrap();
        store
            .enqueue_turn(queued_turn("session-1", "queued-1", 2))
            .await
            .unwrap();

        let result = service
            .submit_turn(queued_turn("session-1", "queued-2", 3), true)
            .await
            .unwrap();

        match result {
            RuntimeQueueSubmitResult::Enqueued {
                queued_turn,
                position,
            } => {
                assert_eq!(queued_turn.queued_turn_id, "queued-2");
                assert_eq!(position, 2);
            }
            other => panic!("unexpected submit result: {other:?}"),
        }
    }
}
