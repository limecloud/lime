use agent_protocol::{
    SessionId, ThreadHistoryChangeSet, ThreadId, ThreadItem, ThreadTurnsView, TurnId,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use thread_store::{
    CanonicalHistory, ThreadHistoryBuilder, ThreadHistoryBuilderError, ThreadStoreResult,
};

use super::{decode_json, error, from_i64, hydrate_thread, read_thread_row, store_error};

pub(super) fn normalize_replayed_change_set(
    session_id: &SessionId,
    thread_id: &ThreadId,
    changes: ThreadHistoryChangeSet,
) -> ThreadStoreResult<ThreadHistoryChangeSet> {
    ThreadHistoryBuilder::for_thread(session_id.clone(), thread_id.clone())
        .apply_change_set(changes)
        .map_err(|source: ThreadHistoryBuilderError| error(source.to_string()))
}

pub(super) fn normalize_persisted_change_set(
    conn: &Connection,
    session_id: &SessionId,
    thread_id: &ThreadId,
    last_sequence: Option<i64>,
    changes: ThreadHistoryChangeSet,
) -> ThreadStoreResult<ThreadHistoryChangeSet> {
    let Some((mut thread, _)) = read_thread_row(conn, thread_id)? else {
        return Err(error(format!("thread {thread_id} does not exist")));
    };
    if &thread.session_id != session_id {
        return Err(error("session/thread identity mismatch"));
    }
    // Ordinary increments only merge their changed Items. Loading every old
    // command output on each text delta makes a long session quadratic again.
    // Rollback/removal still needs the full snapshot to discover affected Items.
    let items = if changes.rollback_to_sequence.is_some()
        || !changes.removed_item_ids.is_empty()
        || !changes.removed_turn_ids.is_empty()
    {
        hydrate_thread(conn, &mut thread, ThreadTurnsView::Full)?;
        thread
            .turns
            .iter()
            .flat_map(|turn| turn.items.iter().cloned())
            .collect()
    } else {
        hydrate_thread(conn, &mut thread, ThreadTurnsView::Summary)?;
        read_changed_item_snapshots(conn, thread_id, &changes)?
    };
    let turn_sequences = read_turn_sequences(conn, thread_id)?;
    let sequence = last_sequence
        .map(|sequence| from_i64(sequence, "history sequence"))
        .transpose()?;
    let mut builder = ThreadHistoryBuilder::from_snapshot(CanonicalHistory {
        session_id: Some(session_id.clone()),
        thread_id: Some(thread_id.clone()),
        sequence,
        turns: thread.turns,
        turn_sequences,
        items,
    })
    .map_err(|source: ThreadHistoryBuilderError| error(source.to_string()))?;
    builder
        .apply_change_set(changes)
        .map_err(|source: ThreadHistoryBuilderError| error(source.to_string()))
}

fn read_changed_item_snapshots(
    conn: &Connection,
    thread_id: &ThreadId,
    changes: &ThreadHistoryChangeSet,
) -> ThreadStoreResult<Vec<ThreadItem>> {
    let mut statement = conn
        .prepare(
            "SELECT item_json FROM canonical_items
             WHERE thread_id = ?1 AND item_id = ?2",
        )
        .map_err(store_error)?;
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for item in &changes.changed_items {
        if !seen.insert(&item.item_id) {
            continue;
        }
        // Query by Item identity, including its previous Turn, so moving an
        // existing Item to another Turn still fails the builder's validation.
        if let Some(value) = statement
            .query_row(params![thread_id.as_str(), item.item_id.as_str()], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(store_error)?
        {
            items.push(decode_json(&value)?);
        }
    }
    Ok(items)
}

fn read_turn_sequences(
    conn: &Connection,
    thread_id: &ThreadId,
) -> ThreadStoreResult<HashMap<TurnId, u64>> {
    let mut statement = conn
        .prepare(
            "SELECT turn_id, last_sequence FROM canonical_turns
             WHERE thread_id = ?1",
        )
        .map_err(store_error)?;
    let rows = statement
        .query_map(params![thread_id.as_str()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(store_error)?;
    let mut sequences = HashMap::new();
    for row in rows {
        let (turn_id, sequence) = row.map_err(store_error)?;
        sequences.insert(TurnId::new(turn_id), from_i64(sequence, "turn sequence")?);
    }
    Ok(sequences)
}
