use crate::session::memory::{MemoryCategory, MemoryRecord, MemorySearchResult};
use crate::session::memory_repository::{MemoryRepository, MemorySearchRow};
use anyhow::Result;
use sqlx::{Pool, Sqlite};
use std::str::FromStr;

fn to_search_result(row: MemorySearchRow, has_query: bool) -> MemorySearchResult {
    let category = MemoryCategory::from_str(&row.category).unwrap_or(MemoryCategory::Patterns);
    let relevance_score = if has_query { (-row.score) as f32 } else { 0.0 };

    MemorySearchResult {
        record: MemoryRecord {
            id: row.id,
            session_id: row.session_id,
            category,
            abstract_text: row.abstract_text,
            overview: row.overview_text,
            content: row.content_text,
            content_hash: row.content_hash,
            source_start_ts: row.source_start_ts,
            source_end_ts: row.source_end_ts,
            created_at: row.created_at,
            updated_at: row.updated_at,
        },
        relevance_score,
    }
}

pub(crate) async fn search_memories(
    pool: &Pool<Sqlite>,
    query: &str,
    limit: Option<usize>,
    session_scope: Option<&str>,
    categories: Option<Vec<MemoryCategory>>,
) -> Result<Vec<MemorySearchResult>> {
    let max_limit = limit.unwrap_or(8).clamp(1, 50);
    let trimmed_query = query.trim();
    let categories = categories.unwrap_or_default();
    let repository = MemoryRepository::new(pool);

    let rows = repository
        .search_memories(trimmed_query, max_limit, session_scope, &categories)
        .await?;

    let result = rows
        .into_iter()
        .map(|row| to_search_result(row, !trimmed_query.is_empty()))
        .collect::<Vec<_>>();

    tracing::info!(
        counter.aster.memory_searches = 1,
        hits = result.len() as u64,
        has_query = !trimmed_query.is_empty(),
        "Memory search completed"
    );

    Ok(result)
}

pub(crate) async fn retrieve_context_memories(
    pool: &Pool<Sqlite>,
    session_id: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<MemoryRecord>> {
    let mut scoped = search_memories(pool, query, Some(limit), Some(session_id), None)
        .await?
        .into_iter()
        .map(|item| item.record)
        .collect::<Vec<_>>();

    if scoped.is_empty() {
        scoped = search_memories(pool, query, Some(limit), None, None)
            .await?
            .into_iter()
            .map(|item| item.record)
            .collect::<Vec<_>>();
    }

    Ok(scoped)
}
