use super::status::{agent_turn_blocks_queue_resume, agent_turn_is_active};
use super::thread_read::ThreadUnloadResult;
use super::{RuntimeCore, RuntimeCoreError, RuntimeCoreState, RuntimeHostContext};
use agent_runtime::session_loop::RuntimeSessionHandle;
use app_server_protocol::{AgentSession, AgentSessionTurnCancelParams};

struct SessionShutdownGuard {
    runtime: RuntimeCore,
    session_id: String,
}

impl Drop for SessionShutdownGuard {
    fn drop(&mut self) {
        self.runtime
            .state
            .lock()
            .expect("runtime core state mutex poisoned")
            .closing_sessions
            .remove(&self.session_id);
        self.runtime.session_shutdown_changed.notify_waiters();
    }
}

impl RuntimeCoreState {
    pub(super) fn ensure_session_accepts_input(
        &self,
        session_id: &str,
    ) -> Result<(), RuntimeCoreError> {
        if self.shutting_down || self.closing_sessions.contains(session_id) {
            return Err(RuntimeCoreError::InvalidRequest(format!(
                "runtime session is shutting down: {session_id}"
            )));
        }
        Ok(())
    }
}

impl RuntimeCore {
    pub(super) async fn shutdown_internal_session(
        &self,
        session_id: &str,
    ) -> Result<(), RuntimeCoreError> {
        loop {
            let changed = self.session_shutdown_changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let session = {
                let mut state = self.state.lock().expect("runtime state");
                let Some(stored) = state.sessions.get(session_id) else {
                    return Ok(());
                };
                let session = stored.session.clone();
                if !state.internal_agents.contains_key(session_id) {
                    return Err(RuntimeCoreError::InvalidRequest(
                        "session is not internal".to_string(),
                    ));
                }
                state
                    .closing_sessions
                    .insert(session_id.to_string())
                    .then_some(session)
            };
            if let Some(session) = session {
                return self.shutdown_session_runtime(session).await;
            }
            changed.await;
        }
    }

    pub(crate) async fn unload_thread_if_idle(
        &self,
        thread_id: &str,
    ) -> Result<ThreadUnloadResult, RuntimeCoreError> {
        let session = {
            let mut state = self
                .state
                .lock()
                .expect("runtime core state mutex poisoned");
            let Some(stored) = state
                .sessions
                .values()
                .find(|stored| stored.session.thread_id == thread_id)
            else {
                return Ok(ThreadUnloadResult::NotLoaded);
            };
            if state.shutting_down
                || state.closing_sessions.contains(&stored.session.session_id)
                || stored
                    .turns
                    .iter()
                    .any(|turn| agent_turn_is_active(turn.status))
            {
                return Ok(ThreadUnloadResult::Active);
            }
            let session = stored.session.clone();
            state.closing_sessions.insert(session.session_id.clone());
            session
        };
        self.shutdown_session_runtime(session).await?;
        Ok(ThreadUnloadResult::Unloaded)
    }

    /// Transport shutdown closes loaded sessions through the same owner as idle unload.
    pub(crate) async fn shutdown(&self) -> Result<(), RuntimeCoreError> {
        let sessions = {
            let mut state = self
                .state
                .lock()
                .expect("runtime core state mutex poisoned");
            state.shutting_down = true;
            state
                .sessions
                .values()
                .map(|stored| stored.session.clone())
                .collect::<Vec<_>>()
        };
        let mut first_error = None;
        for session in sessions {
            loop {
                let changed = self.session_shutdown_changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                let claimed = {
                    let mut state = self
                        .state
                        .lock()
                        .expect("runtime core state mutex poisoned");
                    if !state.sessions.contains_key(&session.session_id) {
                        break;
                    }
                    state.closing_sessions.insert(session.session_id.clone())
                };
                if claimed {
                    if let Err(error) = self.shutdown_session_runtime(session.clone()).await {
                        first_error.get_or_insert(error);
                    }
                    break;
                }
                changed.await;
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    pub(super) async fn shutdown_session_runtime(
        &self,
        session: AgentSession,
    ) -> Result<(), RuntimeCoreError> {
        let _closing = SessionShutdownGuard {
            runtime: self.clone(),
            session_id: session.session_id.clone(),
        };
        // Retain the latest StoredSession until every Command terminal has been persisted.
        let turns = {
            let state = self
                .state
                .lock()
                .expect("runtime core state mutex poisoned");
            state
                .sessions
                .get(&session.session_id)
                .map(|stored| {
                    stored
                        .turns
                        .iter()
                        // Queued submissions stay durable for the next cold resume.
                        .filter(|turn| agent_turn_blocks_queue_resume(turn.status))
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        };
        for turn in turns {
            match self
                .cancel_turn(
                    AgentSessionTurnCancelParams {
                        session_id: session.session_id.clone(),
                        turn_id: turn.turn_id,
                    },
                    RuntimeHostContext::default(),
                )
                .await
            {
                Ok(output) => {
                    for event in output.events {
                        self.event_hub.publish(event);
                    }
                }
                Err(RuntimeCoreError::TurnNotActive(_)) => {}
                Err(error) => return Err(error),
            }
        }
        self.session_loops
            .shutdown(&session.session_id)
            .await
            .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
        let internal = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned")
            .internal_agents
            .get(&session.session_id)
            .cloned();
        if let Some(policy) = internal {
            policy.shutdown_filesystem().await;
        }
        self.backend
            .close_session(&session.session_id, &session.thread_id)
            .await?;
        let mut state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        state.sessions.remove(&session.session_id);
        state.internal_agents.remove(&session.session_id);
        state.thread_elicitation_counts.remove(&session.thread_id);
        state.thread_goal_continuations.remove(&session.session_id);
        Ok(())
    }

    pub(super) async fn session_loop_for_input(
        &self,
        session_id: &str,
        thread_id: &str,
    ) -> Result<RuntimeSessionHandle, RuntimeCoreError> {
        let mut admission = Ok(());
        let session = self
            .session_loops
            .get_or_create_if(session_id, thread_id, || {
                // Shutdown marks state before taking the registry lock. Admission
                // must share that lock so rejected input cannot close its actor.
                let state = self
                    .state
                    .lock()
                    .expect("runtime core state mutex poisoned");
                admission = state
                    .ensure_session_accepts_input(session_id)
                    .and_then(|()| {
                        state
                            .sessions
                            .contains_key(session_id)
                            .then_some(())
                            .ok_or_else(|| {
                                RuntimeCoreError::SessionNotFound(session_id.to_string())
                            })
                    });
                admission.is_ok()
            })
            .await
            .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
        admission?;
        Ok(session.expect("successful admission retains a runtime session actor"))
    }
}
