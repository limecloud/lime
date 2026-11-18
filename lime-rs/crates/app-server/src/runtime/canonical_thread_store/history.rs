use super::*;

impl ProjectionStore {
    pub(super) fn apply_history_sync(
        &self,
        params: ApplyThreadHistoryParams,
    ) -> ThreadStoreResult<ApplyThreadHistoryResult> {
        self.apply_history_sync_with_snapshot(params, true, &[], None)
    }

    pub(in crate::runtime) fn apply_history_with_runtime_sync(
        &self,
        params: ApplyThreadHistoryParams,
        runtime_events: &[AgentEvent],
        sidecar_store: Option<&super::super::SidecarStore>,
    ) -> ThreadStoreResult<ApplyThreadHistoryResult> {
        self.apply_history_sync_with_snapshot(params, true, runtime_events, sidecar_store)
    }

    pub(super) fn apply_history_sync_with_snapshot(
        &self,
        mut params: ApplyThreadHistoryParams,
        refresh_snapshot: bool,
        runtime_events: &[AgentEvent],
        sidecar_store: Option<&super::super::SidecarStore>,
    ) -> ThreadStoreResult<ApplyThreadHistoryResult> {
        validate_change_set(&params)?;
        let fingerprint = if runtime_events.is_empty() {
            change_fingerprint(&params)?
        } else {
            let mut value = serde_json::to_value((&params, runtime_events)).map_err(store_error)?;
            value.sort_all_objects();
            hex::encode(Sha256::digest(
                serde_json::to_vec(&value).map_err(store_error)?,
            ))
        };
        let mut conn = self.open_thread_store()?;
        let tx = conn.transaction().map_err(store_error)?;
        let (stored_session_id, last_sequence, rollout_path, archived) = tx
            .query_row(
                "SELECT session_id, last_sequence, rollout_path, archived
                 FROM canonical_threads WHERE thread_id = ?1",
                params![params.thread_id.as_str()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)? != 0,
                    ))
                },
            )
            .optional()
            .map_err(store_error)?
            .ok_or_else(|| error(format!("thread {} does not exist", params.thread_id)))?;
        if stored_session_id != params.session_id.as_str() {
            return Err(error("session/thread identity mismatch"));
        }
        if archived {
            return Err(error(format!("thread {} is archived", params.thread_id)));
        }
        if self.rollout_store().is_some() && rollout_path.is_none() {
            return Err(error(format!(
                "thread {} has no rollout_path; migration is required",
                params.thread_id
            )));
        }

        if let Some(existing) = tx
            .query_row(
                "SELECT fingerprint FROM canonical_history_applies
                 WHERE thread_id = ?1 AND sequence = ?2",
                params![
                    params.thread_id.as_str(),
                    to_i64(params.changes.sequence, "history sequence")?
                ],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(store_error)?
        {
            if existing == fingerprint {
                if let (Some(store), Some(path)) = (self.rollout_store(), rollout_path.as_deref()) {
                    store
                        .verify_history(
                            std::path::Path::new(path),
                            params.session_id.as_str(),
                            params.thread_id.as_str(),
                            params.changes.sequence,
                            &fingerprint,
                        )
                        .map_err(error)?;
                }
                return Ok(ApplyThreadHistoryResult {
                    sequence: params.changes.sequence,
                    applied: false,
                });
            }
            return Err(error(format!(
                "history sequence collision at {}",
                params.changes.sequence
            )));
        }
        params.changes = normalize_persisted_change_set(
            &tx,
            &params.session_id,
            &params.thread_id,
            last_sequence,
            params.changes,
        )?;
        // Items have their own incremental records. A normalized Turn also
        // contains all prior Items for read projections; persisting that view
        // on every delta makes a streamed response grow the rollout quadratically.
        for turn in &mut params.changes.changed_turns {
            *turn = turn_without_items(turn.clone());
        }
        if last_sequence.is_some_and(|value| params.changes.sequence <= value.max(0) as u64) {
            return Err(error(format!(
                "stale history sequence {} after {}",
                params.changes.sequence,
                last_sequence.unwrap_or_default()
            )));
        }

        apply_change_set(&tx, &params)?;
        if refresh_snapshot {
            refresh_thread_snapshot(&tx, &params.thread_id, params.changes.sequence)?;
        } else {
            tx.execute(
                "UPDATE canonical_threads SET last_sequence = ?2 WHERE thread_id = ?1",
                params![
                    params.thread_id.as_str(),
                    to_i64(params.changes.sequence, "history sequence")?
                ],
            )
            .map_err(store_error)?;
        }
        tx.execute(
            "INSERT INTO canonical_history_applies (thread_id, sequence, fingerprint)
             VALUES (?1, ?2, ?3)",
            params![
                params.thread_id.as_str(),
                to_i64(params.changes.sequence, "history sequence")?,
                fingerprint,
            ],
        )
        .map_err(store_error)?;
        if let (Some(store), Some(path)) = (self.rollout_store(), rollout_path.as_deref()) {
            store
                .append_history(
                    std::path::Path::new(path),
                    params.session_id.as_str(),
                    params.thread_id.as_str(),
                    &fingerprint,
                    &params.changes,
                    runtime_events,
                    sidecar_store,
                )
                .map_err(error)?;
        }
        tx.commit().map_err(store_error)?;
        Ok(ApplyThreadHistoryResult {
            sequence: params.changes.sequence,
            applied: true,
        })
    }
}

impl ProjectionStore {
    pub(super) fn append_items_sync(
        &self,
        params: AppendThreadItemsParams,
    ) -> ThreadStoreResult<ApplyThreadHistoryResult> {
        validate_append_items(&params)?;
        if params.items.is_empty() {
            let conn = self.open_thread_store()?;
            let stored_session_id = conn
                .query_row(
                    "SELECT session_id FROM canonical_threads WHERE thread_id = ?1",
                    params![params.thread_id.as_str()],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(store_error)?
                .ok_or_else(|| error(format!("thread {} does not exist", params.thread_id)))?;
            if stored_session_id != params.session_id.as_str() {
                return Err(error("session/thread identity mismatch"));
            }
            return Ok(ApplyThreadHistoryResult {
                sequence: params.sequence,
                applied: false,
            });
        }
        self.apply_history_sync_with_snapshot(
            ApplyThreadHistoryParams {
                session_id: params.session_id,
                thread_id: params.thread_id,
                changes: ThreadHistoryChangeSet {
                    sequence: params.sequence,
                    changed_items: params.items,
                    ..Default::default()
                },
            },
            false,
            &[],
            None,
        )
    }
}
