use super::*;

impl RolloutStore {
    pub(in crate::runtime) fn append_history(
        &self,
        relative_path: &Path,
        session_id: &str,
        thread_id: &str,
        fingerprint: &str,
        changes: &ThreadHistoryChangeSet,
        runtime_events: &[AgentEvent],
        sidecar_store: Option<&super::super::SidecarStore>,
    ) -> Result<bool, String> {
        let _writer = self.acquire_writer(thread_id)?;
        let (changes, runtime_events) =
            media::portable_history(changes, runtime_events, sidecar_store, session_id)?;
        let (changes, runtime_events) = (&changes, runtime_events.as_slice());
        scan::validate_runtime_events(session_id, thread_id, changes.sequence, runtime_events)?;
        let path = self.resolve_active(relative_path)?;
        self.materialize_rollout_for_append_blocking(&path)?;
        tail_repair::repair_crash_tail(&path)?;
        let latest =
            append_guard::latest_history_for_append(&path, relative_path, session_id, thread_id)?;
        if let Some(existing) = latest
            .as_ref()
            .filter(|record| record.sequence == changes.sequence)
        {
            if existing.fingerprint == fingerprint
                && existing.content_digest
                    == history_content_digest(session_id, thread_id, changes, runtime_events)?
            {
                return Ok(false);
            }
            return Err(format!(
                "rollout history sequence collision at {}",
                changes.sequence
            ));
        }
        if latest
            .as_ref()
            .is_some_and(|record| record.sequence > changes.sequence)
        {
            return Err(format!(
                "rollout history sequence {} is stale",
                changes.sequence
            ));
        }
        if runtime_events.first().is_some_and(|event| {
            latest
                .as_ref()
                .is_some_and(|record| event.sequence <= record.sequence)
        }) {
            return Err("rollout runtime event batches overlap".to_string());
        }
        let record = RolloutRecord::ThreadHistory {
            schema_version: ROLLOUT_SCHEMA_VERSION,
            session_id: session_id.to_string(),
            thread_id: thread_id.to_string(),
            sequence: changes.sequence,
            fingerprint: fingerprint.to_string(),
            content_digest: history_content_digest(session_id, thread_id, changes, runtime_events)?,
            changes: changes.clone(),
            runtime_events: runtime_events.to_vec(),
        };
        let mut file = OpenOptions::new()
            .append(true)
            .open(&path)
            .map_err(|error| format!("failed to open rollout file {}: {error}", path.display()))?;
        write_synced_record(&mut file, &path, &record)?;
        Ok(true)
    }

    pub(in crate::runtime) fn verify_history(
        &self,
        relative_path: &Path,
        session_id: &str,
        thread_id: &str,
        sequence: u64,
        fingerprint: &str,
    ) -> Result<(), String> {
        let _writer = self.acquire_writer(thread_id)?;
        let path = self.resolve_active(relative_path)?;
        let scan = scan_rollout_repaired(&path)?;
        validate_scan_identity(&scan, relative_path, session_id, thread_id, &path)?;
        match scan
            .history
            .iter()
            .find(|record| record.sequence == sequence)
        {
            Some(record) if record.fingerprint == fingerprint => Ok(()),
            Some(_) => Err(format!("rollout history sequence collision at {sequence}")),
            None => Err(format!(
                "rollout is missing committed history sequence {sequence}: {}",
                path.display()
            )),
        }
    }
}
