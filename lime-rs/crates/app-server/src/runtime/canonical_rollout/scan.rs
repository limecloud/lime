use super::*;

pub(super) fn scan_rollout_reader(
    reader: impl BufRead,
    path: &Path,
) -> Result<RolloutScan, String> {
    let mut history = Vec::new();
    let mut scan = scan_rollout_reader_with_history(reader, path, |_, record| {
        history.push(record);
        Ok(())
    })?;
    scan.history = history;
    Ok(scan)
}

pub(super) fn scan_rollout_reader_with_history(
    reader: impl BufRead,
    path: &Path,
    mut on_history: impl FnMut(&Thread, RolloutHistoryRecord) -> Result<(), String>,
) -> Result<RolloutScan, String> {
    let mut lines = reader.lines();
    let first = lines
        .next()
        .ok_or_else(|| format!("rollout file is empty: {}", path.display()))?
        .map_err(|error| format!("failed to read rollout file {}: {error}", path.display()))?;
    let RolloutRecord::SessionMeta {
        schema_version,
        session_id,
        thread_id,
        created_at_ms,
        rollout_path,
        thread: initial_thread,
        ..
    } = parse_record(&first, path)?
    else {
        return Err(format!(
            "rollout first line must be session metadata: {}",
            path.display()
        ));
    };
    if !digest::supported_schema_version(schema_version) {
        return Err(format!(
            "unsupported rollout schema version {schema_version}: {}",
            path.display()
        ));
    }
    let mut initial_thread = initial_thread;
    // Resolve the optional recency default from the session header, before
    // metadata revisions advance their independent updated_at timestamp.
    let recency_at_ms = initial_thread
        .recency_at_ms
        .unwrap_or(initial_thread.updated_at_ms);
    let mut metadata_digest = metadata_content_digest(
        &session_id,
        &thread_id,
        initial_thread.updated_at_ms,
        &initial_thread.metadata,
    )?;
    let mut last_sequence = None;
    let mut event_ids = std::collections::HashSet::new();
    for line in lines {
        let line = line
            .map_err(|error| format!("failed to read rollout file {}: {error}", path.display()))?;
        match parse_record(&line, path)? {
            RolloutRecord::ThreadHistory {
                schema_version,
                session_id: record_session_id,
                thread_id: record_thread_id,
                sequence,
                fingerprint,
                content_digest,
                changes,
                runtime_events,
            } => {
                if !digest::supported_schema_version(schema_version)
                    || record_session_id != session_id
                    || record_thread_id != thread_id
                    || changes.sequence != sequence
                    || !is_sha256_hex(&fingerprint)
                    || history_content_digest(&session_id, &thread_id, &changes, &runtime_events)?
                        != content_digest
                {
                    return Err(format!(
                        "invalid rollout history record: {}",
                        path.display()
                    ));
                }
                validate_runtime_events(&session_id, &thread_id, sequence, &runtime_events)?;
                for event in &runtime_events {
                    if !event_ids.insert(event.event_id.clone()) {
                        return Err("rollout runtime event identity collision".to_string());
                    }
                }
                if runtime_events.first().is_some_and(|event| {
                    last_sequence.is_some_and(|sequence| event.sequence <= sequence)
                }) {
                    return Err("rollout runtime event batches overlap".to_string());
                }
                if last_sequence.is_some_and(|previous| previous >= sequence) {
                    return Err(format!(
                        "rollout history sequence is not strictly increasing: {}",
                        path.display()
                    ));
                }
                last_sequence = Some(sequence);
                on_history(
                    &initial_thread,
                    RolloutHistoryRecord {
                        sequence,
                        fingerprint,
                        changes,
                        runtime_events,
                    },
                )?;
            }
            RolloutRecord::ThreadMetadata {
                schema_version,
                session_id: record_session_id,
                thread_id: record_thread_id,
                updated_at_ms,
                previous_content_digest,
                content_digest,
                metadata,
            } => {
                if !digest::supported_schema_version(schema_version)
                    || record_session_id != session_id
                    || record_thread_id != thread_id
                    || previous_content_digest != metadata_digest
                    || updated_at_ms < initial_thread.updated_at_ms
                    || metadata_content_digest(&session_id, &thread_id, updated_at_ms, &metadata)?
                        != content_digest
                {
                    return Err(format!(
                        "invalid rollout metadata record: {}",
                        path.display()
                    ));
                }
                initial_thread.metadata = metadata;
                initial_thread.updated_at_ms = updated_at_ms;
                metadata_digest = content_digest;
            }
            RolloutRecord::SessionMeta { .. } => {
                return Err(format!(
                    "rollout session metadata may only appear on the first line: {}",
                    path.display()
                ));
            }
        }
    }
    Ok(RolloutScan {
        session_id,
        thread_id,
        created_at_ms,
        rollout_path,
        initial_thread,
        recency_at_ms,
        metadata_digest,
        history: Vec::new(),
    })
}

pub(super) fn validate_runtime_events(
    session_id: &str,
    thread_id: &str,
    through_sequence: u64,
    events: &[AgentEvent],
) -> Result<(), String> {
    let mut previous = 0;
    let mut identities = std::collections::HashSet::new();
    for event in events {
        if event.session_id != session_id
            || event.thread_id.as_deref().is_some_and(|id| id != thread_id)
            || event.sequence <= previous
            || event.sequence > through_sequence
            || event.event_id.trim().is_empty()
            || !identities.insert(&event.event_id)
        {
            return Err("invalid rollout runtime event identity or sequence".to_string());
        }
        if event.event_type == agent_runtime::model_history::MODEL_HISTORY_EVENT_TYPE {
            serde_json::from_value::<agent_runtime::model_history::ModelHistoryRecord>(
                event.payload.clone(),
            )
            .map_err(|error| format!("invalid rollout model history: {error}"))?
            .into_message()?;
        }
        previous = event.sequence;
    }
    if events
        .last()
        .is_some_and(|event| event.sequence != through_sequence)
        || events
            .windows(2)
            .any(|pair| pair[1].sequence != pair[0].sequence + 1)
    {
        return Err("rollout runtime event batch is incomplete".to_string());
    }
    Ok(())
}
