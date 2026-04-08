use crate::session::memory::{CommitOptions, CommitReport};
use crate::session::memory_deduplicator::build_memory_candidate;
use crate::session::memory_extractor::extract_text_for_memory;
use crate::session::memory_repository::{MemoryInsertPayload, MemoryRepository};
use anyhow::Result;
use sqlx::{Pool, Sqlite};

pub(crate) async fn commit_session(
    pool: &Pool<Sqlite>,
    session_id: &str,
    options: CommitOptions,
) -> Result<CommitReport> {
    let repository = MemoryRepository::new(pool);
    if !repository.session_exists(session_id).await? {
        anyhow::bail!("Session not found: {}", session_id);
    }

    let last_committed_ts = if options.force {
        0
    } else {
        repository
            .last_commit_source_end_ts(session_id)
            .await?
            .unwrap_or(0)
    };

    let max_messages = options.max_messages.unwrap_or(200).min(1000) as i64;
    let mut rows = repository
        .load_messages_since(session_id, last_committed_ts, max_messages)
        .await?;
    rows.reverse();

    let mut created = 0usize;
    let mut merged = 0usize;
    let mut warnings = Vec::new();
    let mut source_start_ts = None;
    let mut source_end_ts = None;
    let mut tx = pool.begin().await?;

    for row in &rows {
        if source_start_ts.is_none() {
            source_start_ts = Some(row.created_timestamp);
        }
        source_end_ts = Some(row.created_timestamp);

        let text = match extract_text_for_memory(&row.content_json) {
            Ok(text) => text,
            Err(error) => {
                warnings.push(format!("Failed to parse message content: {}", error));
                continue;
            }
        };

        let Some(candidate) = build_memory_candidate(&row.role, &text) else {
            continue;
        };

        let existing_id = repository
            .find_memory_by_hash(&mut tx, &candidate.content_hash)
            .await?;

        if let Some(existing_id) = existing_id {
            repository
                .touch_memory(&mut tx, existing_id, row.created_timestamp)
                .await?;
            repository
                .link_memory_to_session(&mut tx, existing_id, session_id)
                .await?;
            merged += 1;
            continue;
        }

        let payload = MemoryInsertPayload {
            category: candidate.category,
            abstract_text: candidate.abstract_text,
            overview_text: candidate.overview_text,
            content_text: candidate.content_text,
            content_hash: candidate.content_hash,
        };

        let memory_id = repository
            .insert_memory(&mut tx, session_id, &payload, row.created_timestamp)
            .await?;
        repository
            .link_memory_to_session(&mut tx, memory_id, session_id)
            .await?;

        created += 1;
    }

    let commit_source_end_ts =
        source_end_ts.or_else(|| (last_committed_ts > 0).then_some(last_committed_ts));

    let payload_json = serde_json::json!({
        "messages_scanned": rows.len(),
        "memories_created": created,
        "memories_merged": merged,
        "warnings": warnings,
    })
    .to_string();

    repository
        .append_commit_event(&mut tx, session_id, &payload_json, commit_source_end_ts)
        .await?;

    tx.commit().await?;

    tracing::info!(
        counter.aster.memory_commits = 1,
        session_id = session_id,
        messages_scanned = rows.len() as u64,
        memories_created = created as u64,
        memories_merged = merged as u64,
        "Session memory commit complete"
    );

    Ok(CommitReport {
        session_id: session_id.to_string(),
        messages_scanned: rows.len(),
        memories_created: created,
        memories_merged: merged,
        source_start_ts,
        source_end_ts: commit_source_end_ts,
        warnings,
    })
}
