use super::*;
use serde_json::Value;
use std::path::Path;

impl ProjectionStore {
    pub(crate) fn rollout_path_for_thread_sync(
        &self,
        thread_id: &ThreadId,
    ) -> Result<Option<std::path::PathBuf>, String> {
        let conn = self
            .open_thread_store()
            .map_err(|error| error.to_string())?;
        let stored = conn
            .query_row(
                "SELECT rollout_path FROM canonical_threads WHERE thread_id = ?1",
                params![thread_id.as_str()],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .flatten();
        stored
            .map(|path| {
                self.rollout_store()
                    .ok_or("canonical rollout store is unavailable")?
                    .absolute_path(Path::new(&path))
            })
            .transpose()
    }

    pub(super) fn persist_rollout_metadata(
        &self,
        conn: &Connection,
        expected: &Thread,
        next: &mut Thread,
        archived: bool,
    ) -> ThreadStoreResult<()> {
        if expected.metadata == next.metadata {
            return Ok(());
        }
        let Some(store) = self.rollout_store() else {
            return Ok(());
        };
        let path = conn
            .query_row(
                "SELECT rollout_path FROM canonical_threads WHERE thread_id = ?1",
                params![expected.thread_id.as_str()],
                |row| row.get::<_, Option<String>>(0),
            )
            .map_err(store_error)?
            .ok_or_else(|| error("thread metadata update requires a rollout path"))?;
        // Other index fields retain their existing owners; the rollout metadata record
        // only carries metadata and its timestamp.
        let mut metadata_next = expected.clone();
        metadata_next.metadata = next.metadata.clone();
        metadata_next.updated_at_ms = next.updated_at_ms;
        next.updated_at_ms = store
            .append_metadata(Path::new(&path), expected, &metadata_next, archived)
            .map_err(error)?;
        Ok(())
    }

    pub(in crate::runtime) fn thread_for_rollout_path_sync(
        &self,
        requested: &Path,
    ) -> Result<(Thread, u64, Vec<AgentEvent>), String> {
        let rollout = self
            .rollout_store()
            .ok_or_else(|| "canonical rollout store is unavailable".to_string())?;
        let (requested_path, mut thread, sequence, events) =
            rollout.read_requested_thread(requested)?;
        let conn = self
            .open_thread_store()
            .map_err(|error| error.to_string())?;
        if let Some((current, _)) =
            read_thread_row(&conn, &thread.thread_id).map_err(|error| error.to_string())?
        {
            // Archived/readiness and current settings are metadata facts. History always
            // comes from the requested file, including explicit older rollout copies.
            thread.archived |= current.archived;
            if current
                .metadata
                .get("historyMode")
                .or_else(|| current.metadata.get("history_mode"))
                .and_then(Value::as_str)
                == Some("paginated")
            {
                let current_path = self
                    .rollout_path_for_thread_sync(&current.thread_id)?
                    .ok_or_else(|| "paginated thread has no current rollout path".to_string())?;
                let (current_path, _, _, _) = rollout.read_requested_thread(&current_path)?;
                if requested_path != current_path {
                    return Err(format!("cannot fork paginated thread {} with stale path; omit path and use threadId", thread.thread_id));
                }
            }
            // Codex keeps current model/effort settings from its index even when an
            // explicit older rollout supplies the history. Keep Lime's provider route
            // and model-bound settings together so a cross-provider switch stays valid.
            if thread.metadata.is_null() {
                thread.metadata = serde_json::json!({});
            }
            let metadata = thread
                .metadata
                .as_object_mut()
                .ok_or_else(|| "rollout thread metadata must be an object".to_string())?;
            for key in [
                "modelName",
                "model",
                "providerSelector",
                "providerName",
                "modelProvider",
                "reasoningEffort",
                "reasoning_effort",
                "effort",
                "collaborationMode",
                "serviceTier",
                "service_tier",
            ] {
                if let Some(value) = current.metadata.get(key) {
                    metadata.insert(key.to_string(), value.clone());
                } else {
                    metadata.remove(key);
                }
            }
            thread.name = current.name;
            thread.model_provider = current.model_provider;
        }
        Ok((thread, sequence, events))
    }

    pub(in crate::runtime) fn runtime_events_for_thread_sync(
        &self,
        thread_id: &ThreadId,
    ) -> Result<Option<Vec<AgentEvent>>, String> {
        let Some(rollout) = self.rollout_store() else {
            return Ok(None);
        };
        let Some(path) = self.rollout_path_for_thread_sync(thread_id)? else {
            return Ok(None);
        };
        let (_, _, _, events) = rollout.read_requested_thread(Path::new(&path))?;
        Ok(Some(events))
    }
}

impl ProjectionStore {
    pub(in crate::runtime) fn rebuild_canonical_rollouts_if_empty(&self) -> Result<usize, String> {
        let Some(rollout_store) = self.rollout_store() else {
            return Ok(0);
        };
        let mut conn = self
            .open_thread_store()
            .map_err(|error| error.to_string())?;
        let existing_count = conn
            .query_row("SELECT COUNT(*) FROM canonical_threads", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|error| error.to_string())?;
        let rebuild_projected = projected_tables_are_empty(&conn)?;
        if existing_count > 0 {
            if !rebuild_projected {
                return Ok(0);
            }
            let thread_ids = {
                let mut statement = conn
                    .prepare("SELECT thread_id FROM canonical_threads ORDER BY thread_id")
                    .map_err(|error| error.to_string())?;
                let rows = statement
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(|error| error.to_string())?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|error| error.to_string())?
            };
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(store_error)
                .map_err(|error| error.to_string())?;
            for thread_id in &thread_ids {
                let thread_id = ThreadId::new(thread_id.clone());
                let last_sequence = tx
                    .query_row(
                        "SELECT last_sequence FROM canonical_threads WHERE thread_id = ?1",
                        params![thread_id.as_str()],
                        |row| row.get::<_, Option<i64>>(0),
                    )
                    .map_err(|error| error.to_string())?
                    .unwrap_or_default()
                    .max(0) as u64;
                let (mut thread, _) = read_thread_row(&tx, &thread_id)
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| format!("canonical thread {thread_id} is missing"))?;
                hydrate_thread(&tx, &mut thread, ThreadTurnsView::Full)
                    .map_err(|error| error.to_string())?;
                rebuild_projected_thread_snapshot(&tx, &thread, last_sequence)?;
            }
            tx.commit().map_err(|error| error.to_string())?;
            return Ok(thread_ids.len());
        }
        let snapshots = rollout_store.snapshots()?;
        if snapshots.is_empty() {
            return Ok(0);
        }
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)
            .map_err(|error| error.to_string())?;
        let mut rebuilt = 0;
        for snapshot in snapshots {
            let mut thread = snapshot.initial_thread;
            if !thread.turns.is_empty() {
                return Err("rollout session metadata must not embed turns".to_string());
            }
            thread.archived = snapshot.archived;
            let rollout_path = rollout_store.location_storage_path(&snapshot.relative_path)?;
            insert_thread_row(&tx, thread.clone(), Some(&rollout_path))
                .map_err(|error| error.to_string())?;
            let mut last_sequence = None;
            for record in snapshot.history {
                if last_sequence.is_some_and(|last| record.sequence <= last) {
                    return Err(format!(
                        "rollout history sequence {} is not after {}",
                        record.sequence,
                        last_sequence.unwrap_or_default()
                    ));
                }
                let params = ApplyThreadHistoryParams {
                    session_id: thread.session_id.clone(),
                    thread_id: thread.thread_id.clone(),
                    changes: record.changes,
                };
                validate_change_set(&params).map_err(|error| error.to_string())?;
                if params.changes.sequence != record.sequence {
                    return Err(format!(
                        "rollout history sequence mismatch at {}",
                        record.sequence
                    ));
                }
                apply_change_set(&tx, &params).map_err(|error| error.to_string())?;
                refresh_thread_snapshot(&tx, &thread.thread_id, record.sequence)
                    .map_err(|error| error.to_string())?;
                tx.execute(
                    "INSERT INTO canonical_history_applies (thread_id, sequence, fingerprint)
                     VALUES (?1, ?2, ?3)",
                    params![
                        thread.thread_id.as_str(),
                        to_i64(record.sequence, "history sequence")
                            .map_err(|error| error.to_string())?,
                        record.fingerprint,
                    ],
                )
                .map_err(|error| error.to_string())?;
                last_sequence = Some(record.sequence);
            }
            if rebuild_projected {
                let (mut projected_thread, _) = read_thread_row(&tx, &thread.thread_id)
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| "rebuilt canonical thread is missing".to_string())?;
                hydrate_thread(&tx, &mut projected_thread, ThreadTurnsView::Full)
                    .map_err(|error| error.to_string())?;
                rebuild_projected_thread_snapshot(
                    &tx,
                    &projected_thread,
                    last_sequence.unwrap_or_default(),
                )?;
            }
            rebuilt += 1;
        }
        tx.commit().map_err(|error| error.to_string())?;
        Ok(rebuilt)
    }
}
