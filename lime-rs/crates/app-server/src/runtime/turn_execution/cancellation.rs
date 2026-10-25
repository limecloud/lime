use super::*;

#[cfg(test)]
mod tests;

impl RuntimeCore {
    pub(super) async fn finish_turn_interrupt(
        &self,
        session: &AgentSession,
        turn: &AgentTurn,
        host: RuntimeHostContext,
    ) -> Result<Vec<AgentEvent>, RuntimeCoreError> {
        self.computer_use.cancel_turn(&session.thread_id, &turn.turn_id);
        let request = CancelExecutionRequest {
            host,
            session: session.clone(),
            turn: turn.clone(),
        };
        self.backend.drain_turn(&request).await?;
        let backend = self.backend.clone();
        tokio::spawn(async move {
            let mut sink = CollectingRuntimeEventSink::default();
            let _ = backend.cancel_turn(request, &mut sink).await;
        });
        if self
            .stored_turn(&session.session_id, &turn.turn_id)?
            .is_some_and(|turn| agent_turn_is_terminal(turn.status))
        {
            // A graceful driver already published the same canonical terminal.
            return Ok(Vec::new());
        }
        self.append_runtime_events(
            &session.session_id,
            &session.thread_id,
            Some(&turn.turn_id),
            vec![RuntimeEvent::new(
                "turn.canceled",
                json!({"source": "turn/interrupt", "backend": "runtime_core"}),
            )],
        )
    }
}
