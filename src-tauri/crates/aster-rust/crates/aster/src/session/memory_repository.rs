use crate::session::memory::{MemoryCategory, MemoryHealth, MemoryStats};
use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::{Pool, QueryBuilder, Sqlite, Transaction};

#[derive(Debug, Clone)]
pub(crate) struct MemoryMessageRow {
    pub(crate) role: String,
    pub(crate) content_json: String,
    pub(crate) created_timestamp: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct MemoryInsertPayload {
    pub(crate) category: MemoryCategory,
    pub(crate) abstract_text: String,
    pub(crate) overview_text: String,
    pub(crate) content_text: String,
    pub(crate) content_hash: String,
}

#[derive(Debug, Clone)]
pub(crate) struct MemorySearchRow {
    pub(crate) id: i64,
    pub(crate) session_id: String,
    pub(crate) category: String,
    pub(crate) abstract_text: String,
    pub(crate) overview_text: String,
    pub(crate) content_text: String,
    pub(crate) content_hash: String,
    pub(crate) source_start_ts: i64,
    pub(crate) source_end_ts: i64,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) score: f64,
}

pub(crate) struct MemoryRepository<'a> {
    pool: &'a Pool<Sqlite>,
}

fn normalize_fts_query(raw: &str) -> Option<String> {
    let mut normalized = String::with_capacity(raw.len());
    let mut last_was_space = false;

    for ch in raw.chars() {
        if ch.is_alphanumeric() {
            for lowered in ch.to_lowercase() {
                normalized.push(lowered);
            }
            last_was_space = false;
            continue;
        }

        if !last_was_space && !normalized.is_empty() {
            normalized.push(' ');
            last_was_space = true;
        }
    }

    let normalized = normalized.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

impl<'a> MemoryRepository<'a> {
    pub(crate) fn new(pool: &'a Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub(crate) async fn session_exists(&self, session_id: &str) -> Result<bool> {
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?)")
                .bind(session_id)
                .fetch_one(self.pool)
                .await?;
        Ok(exists)
    }

    pub(crate) async fn last_commit_source_end_ts(&self, session_id: &str) -> Result<Option<i64>> {
        let last_committed = sqlx::query_scalar::<_, Option<i64>>(
            r#"
            SELECT source_end_ts
            FROM memory_events
            WHERE session_id = ? AND event_type = 'commit'
            ORDER BY id DESC
            LIMIT 1
        "#,
        )
        .bind(session_id)
        .fetch_optional(self.pool)
        .await?
        .flatten();

        Ok(last_committed)
    }

    pub(crate) async fn load_messages_since(
        &self,
        session_id: &str,
        last_committed_ts: i64,
        max_messages: i64,
    ) -> Result<Vec<MemoryMessageRow>> {
        let rows = sqlx::query_as::<_, (String, String, i64)>(
            r#"
            SELECT role, content_json, created_timestamp
            FROM messages
            WHERE session_id = ? AND created_timestamp > ?
            ORDER BY created_timestamp DESC
            LIMIT ?
        "#,
        )
        .bind(session_id)
        .bind(last_committed_ts)
        .bind(max_messages)
        .fetch_all(self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|(role, content_json, created_timestamp)| MemoryMessageRow {
                role,
                content_json,
                created_timestamp,
            })
            .collect())
    }

    pub(crate) async fn find_memory_by_hash(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        content_hash: &str,
    ) -> Result<Option<i64>> {
        let existing = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT id FROM memories WHERE content_hash = ? LIMIT 1",
        )
        .bind(content_hash)
        .fetch_optional(&mut **tx)
        .await?
        .flatten();

        Ok(existing)
    }

    pub(crate) async fn touch_memory(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        memory_id: i64,
        source_end_ts: i64,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE memories SET updated_at = datetime('now'), source_end_ts = MAX(source_end_ts, ?) WHERE id = ?",
        )
        .bind(source_end_ts)
        .bind(memory_id)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    pub(crate) async fn link_memory_to_session(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        memory_id: i64,
        session_id: &str,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO memory_links (memory_id, session_id, relation_type)
            VALUES (?, ?, 'session')
        "#,
        )
        .bind(memory_id)
        .bind(session_id)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    pub(crate) async fn insert_memory(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        session_id: &str,
        payload: &MemoryInsertPayload,
        source_timestamp: i64,
    ) -> Result<i64> {
        let memory_id = sqlx::query_scalar::<_, i64>(
            r#"
            INSERT INTO memories (
                session_id, category, abstract_text, overview_text, content_text, content_hash,
                source_start_ts, source_end_ts
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
        "#,
        )
        .bind(session_id)
        .bind(payload.category.to_string())
        .bind(&payload.abstract_text)
        .bind(&payload.overview_text)
        .bind(&payload.content_text)
        .bind(&payload.content_hash)
        .bind(source_timestamp)
        .bind(source_timestamp)
        .fetch_one(&mut **tx)
        .await?;

        Ok(memory_id)
    }

    pub(crate) async fn append_commit_event(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        session_id: &str,
        payload_json: &str,
        source_end_ts: Option<i64>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO memory_events (session_id, event_type, payload_json, source_end_ts)
            VALUES (?, 'commit', ?, ?)
        "#,
        )
        .bind(session_id)
        .bind(payload_json)
        .bind(source_end_ts)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    pub(crate) async fn search_memories(
        &self,
        query: &str,
        limit: usize,
        session_scope: Option<&str>,
        categories: &[MemoryCategory],
    ) -> Result<Vec<MemorySearchRow>> {
        let trimmed_query = query.trim();
        let search_query = normalize_fts_query(trimmed_query);

        if !trimmed_query.is_empty() && search_query.is_none() {
            return Ok(Vec::new());
        }

        let mut query_builder = if search_query.is_some() {
            QueryBuilder::<Sqlite>::new(
                r#"
                SELECT
                    m.id,
                    m.session_id,
                    m.category,
                    m.abstract_text,
                    m.overview_text,
                    m.content_text,
                    m.content_hash,
                    m.source_start_ts,
                    m.source_end_ts,
                    m.created_at,
                    m.updated_at,
                    bm25(memories_fts) as score
                FROM memories_fts
                JOIN memories m ON m.id = memories_fts.rowid
                WHERE memories_fts MATCH
            "#,
            )
        } else {
            QueryBuilder::<Sqlite>::new(
                r#"
                SELECT
                    m.id,
                    m.session_id,
                    m.category,
                    m.abstract_text,
                    m.overview_text,
                    m.content_text,
                    m.content_hash,
                    m.source_start_ts,
                    m.source_end_ts,
                    m.created_at,
                    m.updated_at,
                    0.0 as score
                FROM memories m
                WHERE 1 = 1
            "#,
            )
        };

        if let Some(ref search_query) = search_query {
            query_builder.push_bind(search_query);
        }

        if let Some(scope) = session_scope {
            query_builder.push(" AND (m.session_id = ");
            query_builder.push_bind(scope);
            query_builder.push(
                " OR EXISTS (SELECT 1 FROM memory_links ml WHERE ml.memory_id = m.id AND ml.session_id = ",
            );
            query_builder.push_bind(scope);
            query_builder.push("))");
        }

        if !categories.is_empty() {
            query_builder.push(" AND m.category IN (");
            let mut separated = query_builder.separated(", ");
            for category in categories {
                separated.push_bind(category.to_string());
            }
            separated.push_unseparated(")");
        }

        if search_query.is_none() {
            query_builder.push(" ORDER BY m.updated_at DESC ");
        } else {
            query_builder.push(" ORDER BY score ASC, m.updated_at DESC ");
        }
        query_builder.push(" LIMIT ");
        query_builder.push_bind(limit as i64);

        let rows = query_builder
            .build_query_as::<(
                i64,
                String,
                String,
                String,
                String,
                String,
                String,
                i64,
                i64,
                DateTime<Utc>,
                DateTime<Utc>,
                f64,
            )>()
            .fetch_all(self.pool)
            .await?;

        Ok(rows
            .into_iter()
            .map(
                |(
                    id,
                    session_id,
                    category,
                    abstract_text,
                    overview_text,
                    content_text,
                    content_hash,
                    source_start_ts,
                    source_end_ts,
                    created_at,
                    updated_at,
                    score,
                )| MemorySearchRow {
                    id,
                    session_id,
                    category,
                    abstract_text,
                    overview_text,
                    content_text,
                    content_hash,
                    source_start_ts,
                    source_end_ts,
                    created_at,
                    updated_at,
                    score,
                },
            )
            .collect())
    }

    pub(crate) async fn memory_stats(&self) -> Result<MemoryStats> {
        let total_memories = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM memories")
            .fetch_one(self.pool)
            .await?;
        let total_sessions =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(DISTINCT session_id) FROM memories")
                .fetch_one(self.pool)
                .await?;
        let total_events = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM memory_events")
            .fetch_one(self.pool)
            .await?;
        let total_links = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM memory_links")
            .fetch_one(self.pool)
            .await?;

        Ok(MemoryStats {
            total_memories,
            total_sessions,
            total_events,
            total_links,
        })
    }

    pub(crate) async fn memory_health(&self) -> Result<MemoryHealth> {
        let table_exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
              SELECT name FROM sqlite_master
              WHERE type='table' AND name='memories'
            )
        "#,
        )
        .fetch_one(self.pool)
        .await?;

        let fts_exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
              SELECT name FROM sqlite_master
              WHERE type='table' AND name='memories_fts'
            )
        "#,
        )
        .fetch_one(self.pool)
        .await?;

        if table_exists && fts_exists {
            Ok(MemoryHealth {
                healthy: true,
                message: "memory subsystem is healthy".to_string(),
            })
        } else {
            Ok(MemoryHealth {
                healthy: false,
                message: "memory tables are missing".to_string(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_fts_query;

    #[test]
    fn normalize_fts_query_sanitizes_fts_control_characters() {
        assert_eq!(
            normalize_fts_query(r#"  @Bot  foo@example.com  (Error:42) OR  "#),
            Some("bot foo example com error 42 or".to_string())
        );
    }

    #[test]
    fn normalize_fts_query_discards_symbol_only_input() {
        assert_eq!(normalize_fts_query("@@@ !!!"), None);
    }
}
