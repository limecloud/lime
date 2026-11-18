use super::*;

impl ProjectionStore {
    #[cfg(test)]
    pub(in crate::runtime) fn apply_canonical_events(
        &self,
        stored: &StoredSession,
        events: &[AgentEvent],
    ) -> Result<(), String> {
        self.apply_canonical_events_with_media(stored, events, None)
    }

    pub(in crate::runtime) fn apply_canonical_events_with_media(
        &self,
        stored: &StoredSession,
        events: &[AgentEvent],
        sidecar_store: Option<&super::super::SidecarStore>,
    ) -> Result<(), String> {
        if events.is_empty() || super::super::session_is_ephemeral(&stored.session) {
            return Ok(());
        }
        let thread_id = ThreadId::new(stored.session.thread_id.clone());
        let conn = self
            .open_thread_store()
            .map_err(|error| error.to_string())?;
        if read_thread_row(&conn, &thread_id)
            .map_err(|error| error.to_string())?
            .is_none()
        {
            self.create_empty_canonical_thread(stored)?;
        }
        let mut changes = super::super::thread_item_projection::materialize_events(
            events,
            &stored.session.session_id,
            &stored.session.thread_id,
        )
        .map_err(|error| error.to_string())?;
        // Command output deltas need the preceding event context before crossing
        // the store boundary, which consumes complete Item snapshots.
        if !stored.events.is_empty()
            && events.iter().any(|event| {
                event.event_type == "command.output"
                    && event
                        .payload
                        .get("delta")
                        .is_some_and(serde_json::Value::is_string)
            })
        {
            // Replay borrowed events: cloning large provider/model-history
            // payloads here holds the runtime lock throughout allocation/drop.
            let complete = super::super::thread_item_projection::materialize_events(
                stored.events.iter().chain(events),
                &stored.session.session_id,
                &stored.session.thread_id,
            )
            .map_err(|error| error.to_string())?;
            let mut commands = complete
                .changed_items
                .into_iter()
                .filter(|item| {
                    matches!(
                        item.payload,
                        agent_protocol::ThreadItemPayload::Command { .. }
                    )
                })
                .map(|item| ((item.turn_id.clone(), item.item_id.clone()), item))
                .collect::<HashMap<_, _>>();
            for item in &mut changes.changed_items {
                if matches!(
                    item.payload,
                    agent_protocol::ThreadItemPayload::Command { .. }
                ) {
                    if let Some(snapshot) =
                        commands.remove(&(item.turn_id.clone(), item.item_id.clone()))
                    {
                        *item = snapshot;
                    }
                }
            }
        }
        if changes.sequence == 0 {
            return Ok(());
        }
        self.apply_history_with_runtime_sync(
            ApplyThreadHistoryParams {
                session_id: agent_protocol::SessionId::new(stored.session.session_id.clone()),
                thread_id,
                changes,
            },
            events,
            sidecar_store,
        )
        .map_err(|error| error.to_string())?;
        self.apply_goal_accounting_events_sync(stored, events)
            .map_err(|error| error.to_string())
    }
}
