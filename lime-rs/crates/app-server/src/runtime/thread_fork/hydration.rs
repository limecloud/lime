use super::super::{output_refs, queued_turn_intent, turn_input_events, value_fields};
use super::*;
use app_server_protocol::ThreadReadParams;
use chrono::TimeZone;

impl RuntimeCore {
    pub(in crate::runtime) async fn hydrate_thread_session(
        &self,
        thread: &Thread,
    ) -> Result<(), RuntimeCoreError> {
        if thread.forked_from_id.is_none()
            || thread
                .metadata
                .get("forkSequence")
                .and_then(Value::as_u64)
                .is_none()
        {
            return self
                .ensure_current_session_hydrated(thread.session_id.as_str())
                .await;
        }
        if thread.turns_view == ThreadTurnsView::Full {
            return self.hydrate_fork_session_from_canonical(thread);
        }
        let canonical = self
            .read_thread(ThreadReadParams {
                thread_id: thread.thread_id.clone(),
                turns_view: ThreadTurnsView::Full,
            })
            .await?;
        self.hydrate_fork_session_from_canonical(&canonical.thread)
    }

    fn hydrate_fork_session_from_canonical(&self, thread: &Thread) -> Result<(), RuntimeCoreError> {
        if thread.forked_from_id.is_none() {
            return Err(RuntimeCoreError::SessionNotFound(
                thread.session_id.as_str().to_string(),
            ));
        }
        let metadata = thread.metadata.as_object().ok_or_else(|| {
            RuntimeCoreError::Backend("forked thread metadata must be a JSON object".to_string())
        })?;
        let timestamp = |millis: i64| {
            chrono::Utc
                .timestamp_millis_opt(millis)
                .single()
                .map(|value| value.to_rfc3339())
                .unwrap_or_else(value_fields::timestamp)
        };
        let session_id = thread.session_id.as_str().to_string();
        let thread_id = thread.thread_id.as_str().to_string();
        let history_sequence = metadata
            .get("forkSequence")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                RuntimeCoreError::Backend(
                    "forked thread metadata omitted canonical forkSequence".to_string(),
                )
            })?;
        let mut stored = StoredSession {
            session: AgentSession {
                session_id: session_id.clone(),
                thread_id: thread_id.clone(),
                app_id: thread
                    .product
                    .clone()
                    .unwrap_or_else(|| "agent-chat".to_string()),
                workspace_id: metadata
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                business_object_ref: Some(BusinessObjectRef {
                    kind: "agent.thread".to_string(),
                    id: thread_id.clone(),
                    title: thread.name.clone(),
                    uri: None,
                    metadata: Some(thread.metadata.clone()),
                }),
                status: session_status(&thread.status),
                created_at: timestamp(thread.created_at_ms),
                updated_at: timestamp(thread.updated_at_ms),
            },
            turns: thread
                .turns
                .iter()
                .map(|turn| AgentTurn {
                    turn_id: turn.turn_id.as_str().to_string(),
                    session_id: session_id.clone(),
                    thread_id: thread_id.clone(),
                    status: turn_status(turn.status),
                    started_at: turn.started_at_ms.map(timestamp),
                    completed_at: turn.completed_at_ms.map(timestamp),
                })
                .collect(),
            turn_inputs: Default::default(),
            turn_runtime_options: Default::default(),
            events: Vec::new(),
            output_blobs: Default::default(),
        };
        let items = thread
            .turns
            .iter()
            .flat_map(|turn| turn.items.iter())
            .filter(|item| item.sequence <= history_sequence)
            .cloned()
            .collect::<Vec<_>>();
        let item_turn_ids = items
            .iter()
            .map(|item| item.turn_id.as_str())
            .collect::<HashSet<_>>();
        let turns = thread
            .turns
            .iter()
            .filter(|turn| item_turn_ids.contains(turn.turn_id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        stored.events =
            fork_history_seed_events(&stored.session, &turns, &items, history_sequence)?;
        let event_log_events = self
            .event_log_writer
            .as_ref()
            .map(|writer| {
                writer
                    .read_session_events(&session_id)
                    .map(|records| records.into_iter().map(|record| record.event).collect())
                    .map_err(RuntimeCoreError::Backend)
            })
            .transpose()?
            .unwrap_or_default();
        stored.events = merge_fork_history_events(stored.events, event_log_events)?;
        stored.turn_inputs = turn_input_events::turn_inputs_from_events(&stored.events);
        stored.turn_runtime_options =
            queued_turn_intent::runtime_options_from_events(&stored.turns, &stored.events)
                .map_err(RuntimeCoreError::Backend)?;
        stored.output_blobs = stored
            .events
            .iter()
            .filter_map(output_refs::output_record_from_event)
            .map(|record| (record.output_ref.clone(), record))
            .collect();
        let mut state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        match state.sessions.entry(session_id) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(stored);
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                merge_fork_history_seed(entry.get_mut(), stored.events)?;
            }
        }
        Ok(())
    }
}
