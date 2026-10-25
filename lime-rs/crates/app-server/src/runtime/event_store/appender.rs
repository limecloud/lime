use super::*;

impl RuntimeCoreEventAppender {
    pub(crate) fn append_command_runtime_events(
        &self,
        session_id: &str,
        turn_id: &str,
        runtime_events: Vec<RuntimeEvent>,
    ) -> Result<Vec<AgentEvent>, RuntimeCoreError> {
        let mut state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        let stored = state
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| RuntimeCoreError::SessionNotFound(session_id.to_string()))?;
        if !stored.turns.iter().any(|turn| turn.turn_id == turn_id) {
            return Err(RuntimeCoreError::TurnNotActive(turn_id.to_string()));
        }
        for event in &runtime_events {
            let valid = match event.event_type.as_str() {
                "item.started" | "item.updated" | "item.completed" => event
                    .payload
                    .get("item")
                    .cloned()
                    .and_then(|item| {
                        serde_json::from_value::<agent_protocol::ThreadItem>(item).ok()
                    })
                    .is_some_and(|item| {
                        item.session_id.as_str() == session_id
                            && item.thread_id.as_str() == stored.session.thread_id
                            && item.turn_id.as_str() == turn_id
                            && matches!(
                                item.payload,
                                agent_protocol::ThreadItemPayload::Command { .. }
                            )
                    }),
                "tool.output.delta" => event.payload.get("metadata").is_some_and(|metadata| {
                    metadata.get("turn_id").and_then(Value::as_str) == Some(turn_id)
                        && metadata.get("executionSurface").and_then(Value::as_str)
                            == Some("unified_exec")
                }),
                "command.output" | "command.interaction" | "test.started" | "test.completed" => {
                    true
                }
                _ => false,
            };
            if !valid {
                return Err(RuntimeCoreError::Backend(format!(
                    "invalid owned command event scope: {}",
                    event.event_type
                )));
            }
        }
        let thread_id = stored.session.thread_id.clone();
        append_runtime_events_to_stored_session(
            stored,
            self.file_checkpoint_snapshot_store.as_ref(),
            self.output_snapshot_store.as_ref(),
            self.sidecar_store.as_deref(),
            self.event_log_writer.as_deref(),
            self.trace_event_writer.as_deref(),
            self.projection_store.as_deref(),
            Some(&self.session_loops),
            session_id,
            &thread_id,
            Some(turn_id),
            runtime_events,
            None,
            TerminalTurnAppendPolicy::CommandContinuation,
        )
    }

    pub fn append_external_runtime_events(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        runtime_events: Vec<RuntimeEvent>,
    ) -> Result<Vec<AgentEvent>, RuntimeCoreError> {
        let mut state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        let stored = state
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| RuntimeCoreError::SessionNotFound(session_id.to_string()))?;
        self.append_external_runtime_events_locked(stored, session_id, turn_id, runtime_events)
    }

    /// Append while the caller already owns the RuntimeCore state lock.
    ///
    /// Same-turn compaction uses this path so its replacement boundary is derived from and
    /// committed against one immutable event sequence. This closes the read/unlock/relock gap
    /// that could admit a steer or tool event between the compaction snapshot and its durable ACK.
    pub(in crate::runtime) fn append_external_runtime_events_locked(
        &self,
        stored: &mut StoredSession,
        session_id: &str,
        turn_id: Option<&str>,
        runtime_events: Vec<RuntimeEvent>,
    ) -> Result<Vec<AgentEvent>, RuntimeCoreError> {
        if let Some(turn_id) = turn_id {
            if !stored.turns.iter().any(|turn| turn.turn_id == turn_id) {
                return Err(RuntimeCoreError::TurnNotActive(turn_id.to_string()));
            }
        }
        let thread_id = stored.session.thread_id.clone();

        let events = append_runtime_events_to_stored_session(
            stored,
            self.file_checkpoint_snapshot_store.as_ref(),
            self.output_snapshot_store.as_ref(),
            self.sidecar_store.as_deref(),
            self.event_log_writer.as_deref(),
            self.trace_event_writer.as_deref(),
            self.projection_store.as_deref(),
            Some(&self.session_loops),
            session_id,
            &thread_id,
            turn_id,
            runtime_events,
            None,
            TerminalTurnAppendPolicy::Reject,
        )?;
        crate::runtime::computer_use::cancel_terminal_computer_use(
            &self.computer_use,
            &thread_id,
            turn_id,
            &events,
        );
        Ok(events)
    }

    pub(in crate::runtime) fn append_artifact_snapshot(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        payload: Value,
    ) -> Result<Vec<AgentEvent>, RuntimeCoreError> {
        let mut state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        let stored = state
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| RuntimeCoreError::SessionNotFound(session_id.to_string()))?;
        if let Some(turn_id) = turn_id {
            if !stored.turns.iter().any(|turn| turn.turn_id == turn_id) {
                return Err(RuntimeCoreError::TurnNotActive(turn_id.to_string()));
            }
        }
        let thread_id = stored.session.thread_id.clone();

        append_runtime_events_to_stored_session(
            stored,
            self.file_checkpoint_snapshot_store.as_ref(),
            self.output_snapshot_store.as_ref(),
            self.sidecar_store.as_deref(),
            self.event_log_writer.as_deref(),
            self.trace_event_writer.as_deref(),
            self.projection_store.as_deref(),
            Some(&self.session_loops),
            session_id,
            &thread_id,
            turn_id,
            vec![RuntimeEvent::new("artifact.snapshot", payload)],
            None,
            TerminalTurnAppendPolicy::Allow,
        )
    }
}
