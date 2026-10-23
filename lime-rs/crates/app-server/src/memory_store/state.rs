use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS memory_rollout_jobs (
    scope_key TEXT NOT NULL,
    source_path TEXT NOT NULL,
    source_thread_id TEXT,
    content_hash TEXT NOT NULL,
    source_updated_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'consolidated', 'review')),
    lease_owner TEXT,
    lease_expires_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    retry_at INTEGER,
    retry_remaining INTEGER NOT NULL DEFAULT 3,
    output_raw_memory TEXT,
    output_rollout_summary TEXT,
    output_rollout_slug TEXT,
    generated_at INTEGER,
    usage_count INTEGER NOT NULL DEFAULT 0,
    last_usage INTEGER,
    selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope_key, source_path)
);
CREATE INDEX IF NOT EXISTS idx_memory_rollout_jobs_status
    ON memory_rollout_jobs(scope_key, status, updated_at);
CREATE TABLE IF NOT EXISTS memory_phase2_jobs (
    scope_key TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('idle', 'leased', 'succeeded', 'failed')),
    lease_owner TEXT,
    lease_expires_at INTEGER,
    input_watermark INTEGER NOT NULL DEFAULT 0,
    completed_watermark INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    retry_at INTEGER,
    retry_remaining INTEGER NOT NULL DEFAULT 3,
    last_success_at INTEGER,
    updated_at INTEGER NOT NULL
);
"#;

#[derive(Debug, Clone)]
pub(super) struct MemoryStateStore {
    path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct StageTwoInput {
    pub(super) source_path: String,
    pub(super) source_updated_at: String,
    pub(super) content_hash: String,
    pub(super) raw_memory: Option<String>,
    pub(super) rollout_summary: Option<String>,
    pub(super) rollout_slug: Option<String>,
}

#[derive(Debug, Clone)]
struct Phase2Candidate {
    input: StageTwoInput,
    usage_count: i64,
    last_usage: Option<i64>,
    updated_at: i64,
}

impl MemoryStateStore {
    pub(super) fn stage1_candidates(
        &self,
        scope_key: &str,
        limit: usize,
    ) -> Result<Vec<String>, String> {
        let now = now_seconds();
        let conn = self.open()?;
        let mut statement = conn
            .prepare(
                "SELECT source_path FROM memory_rollout_jobs WHERE scope_key = ?1 AND status = 'pending' AND retry_remaining > 0 AND (retry_at IS NULL OR retry_at <= ?2) ORDER BY updated_at, source_path LIMIT ?3",
            )
            .map_err(|error| format!("prepare memory stage1 candidates: {error}"))?;
        let rows = statement
            .query_map(params![scope_key, now, limit.max(1) as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("read memory stage1 candidates: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("collect memory stage1 candidates: {error}"))
    }

    #[cfg(test)]
    pub(super) fn stage2_candidates(
        &self,
        scope_key: &str,
        limit: usize,
    ) -> Result<Vec<StageTwoInput>, String> {
        let conn = self.open()?;
        let mut statement = conn
            .prepare(
                "SELECT source_path, source_updated_at, content_hash, output_raw_memory, output_rollout_summary, output_rollout_slug FROM memory_rollout_jobs WHERE scope_key = ?1 AND status = 'pending' AND (output_raw_memory IS NOT NULL OR output_rollout_summary IS NOT NULL) ORDER BY updated_at, source_path LIMIT ?2",
            )
            .map_err(|error| format!("prepare memory stage2 candidates: {error}"))?;
        let rows = statement
            .query_map(params![scope_key, limit.max(1) as i64], |row| {
                Ok(StageTwoInput {
                    source_path: row.get(0)?,
                    source_updated_at: row.get(1)?,
                    content_hash: row.get(2)?,
                    raw_memory: row.get(3)?,
                    rollout_summary: row.get(4)?,
                    rollout_slug: row.get(5)?,
                })
            })
            .map_err(|error| format!("read memory stage2 candidates: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("collect memory stage2 candidates: {error}"))
    }

    #[cfg(test)]
    pub(super) fn phase2_inputs(
        &self,
        scope_key: &str,
        limit: usize,
    ) -> Result<Vec<StageTwoInput>, String> {
        let conn = self.open()?;
        let mut statement = conn.prepare(
            "SELECT source_path, source_updated_at, content_hash, output_raw_memory, output_rollout_summary, output_rollout_slug FROM memory_rollout_jobs WHERE scope_key = ?1 AND (status = 'pending' OR selected_for_phase2 = 1) AND (output_raw_memory IS NOT NULL OR output_rollout_summary IS NOT NULL) ORDER BY (status = 'pending') DESC, updated_at DESC, source_path LIMIT ?2"
        ).map_err(|e| format!("prepare phase2 inputs: {e}"))?;
        let rows = statement
            .query_map(params![scope_key, limit.max(1) as i64], |row| {
                Ok(StageTwoInput {
                    source_path: row.get(0)?,
                    source_updated_at: row.get(1)?,
                    content_hash: row.get(2)?,
                    raw_memory: row.get(3)?,
                    rollout_summary: row.get(4)?,
                    rollout_slug: row.get(5)?,
                })
            })
            .map_err(|e| format!("read phase2 inputs: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("collect phase2 inputs: {e}"))
    }

    /// Selects the phase-2 snapshot using Codex's usage feedback policy:
    /// recently used memories win, never-used sources remain eligible while fresh,
    /// and stale rows are excluded from a new consolidation pass.
    pub(super) fn phase2_inputs_for_consolidation(
        &self,
        scope_key: &str,
        limit: usize,
        max_unused_days: i64,
    ) -> Result<Vec<StageTwoInput>, String> {
        let conn = self.open()?;
        let mut statement = conn
            .prepare(
                "SELECT source_path, source_updated_at, content_hash, output_raw_memory, output_rollout_summary, output_rollout_slug, status, usage_count, last_usage, updated_at FROM memory_rollout_jobs WHERE scope_key = ?1 AND (status = 'pending' OR selected_for_phase2 = 1) AND (output_raw_memory IS NOT NULL OR output_rollout_summary IS NOT NULL)",
            )
            .map_err(|error| format!("prepare phase2 selection: {error}"))?;
        let rows = statement
            .query_map(params![scope_key], |row| {
                Ok(Phase2Candidate {
                    input: StageTwoInput {
                        source_path: row.get(0)?,
                        source_updated_at: row.get(1)?,
                        content_hash: row.get(2)?,
                        raw_memory: row.get(3)?,
                        rollout_summary: row.get(4)?,
                        rollout_slug: row.get(5)?,
                    },
                    usage_count: row.get(7)?,
                    last_usage: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|error| format!("read phase2 selection: {error}"))?;
        let now = now_seconds();
        let cutoff = now.saturating_sub(max_unused_days.max(0).saturating_mul(86_400));
        let mut candidates = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("collect phase2 selection: {error}"))?
            .into_iter()
            .filter_map(|candidate| {
                let source_time = parse_source_timestamp(&candidate.input.source_updated_at)
                    .unwrap_or(candidate.updated_at);
                let recency = candidate.last_usage.unwrap_or(source_time);
                (recency >= cutoff).then_some((recency, candidate))
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|(left_recency, left), (right_recency, right)| {
            right
                .usage_count
                .cmp(&left.usage_count)
                .then_with(|| right_recency.cmp(left_recency))
                .then_with(|| {
                    right
                        .input
                        .source_updated_at
                        .cmp(&left.input.source_updated_at)
                })
                .then_with(|| right.input.source_path.cmp(&left.input.source_path))
        });
        Ok(candidates
            .into_iter()
            .take(limit.max(1))
            .map(|(_, candidate)| candidate.input)
            .collect())
    }

    pub(super) fn new(data_root: &Path) -> Self {
        Self {
            path: data_root.join("memory_state.sqlite"),
        }
    }

    /// Re-registering the same source version must preserve its output and active lease.
    /// A new version cannot inherit extraction output or selection from its predecessor.
    pub(super) fn register_rollout(
        &self,
        scope_key: &str,
        source_path: &str,
        content: &str,
        source_updated_at: &str,
    ) -> Result<(), String> {
        let now = now_seconds();
        let content_hash = hash_content(content);
        let source_thread_id = source_thread_id_from_content(content);
        let conn = self.open()?;
        conn.execute(
            r#"
            INSERT INTO memory_rollout_jobs
                (scope_key, source_path, source_thread_id, content_hash, source_updated_at, status, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)
            ON CONFLICT(scope_key, source_path) DO UPDATE SET
                source_thread_id = excluded.source_thread_id,
                content_hash = excluded.content_hash,
                source_updated_at = excluded.source_updated_at,
                status = 'pending',
                lease_owner = NULL,
                lease_expires_at = NULL,
                output_raw_memory = NULL,
                output_rollout_summary = NULL,
                output_rollout_slug = NULL,
                generated_at = NULL,
                selected_for_phase2 = 0,
                retry_at = NULL,
                retry_remaining = 3,
                last_error = NULL,
                updated_at = excluded.updated_at
            WHERE memory_rollout_jobs.content_hash != excluded.content_hash
               OR memory_rollout_jobs.source_updated_at != excluded.source_updated_at
               OR COALESCE(memory_rollout_jobs.source_thread_id, '') != COALESCE(excluded.source_thread_id, '')
            "#,
            params![scope_key, source_path, source_thread_id, content_hash, source_updated_at, now],
        )
        .map_err(|error| format!("register memory rollout: {error}"))?;
        Ok(())
    }

    pub(super) fn count_consolidated(&self, scope_key: &str) -> Result<u32, String> {
        let conn = self.open()?;
        conn.query_row(
            "SELECT COUNT(*) FROM memory_rollout_jobs WHERE scope_key = ?1 AND status = 'consolidated'",
            params![scope_key],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.clamp(0, i64::from(u32::MAX)) as u32)
        .map_err(|error| format!("count consolidated memories: {error}"))
    }

    pub(super) fn try_claim_phase2(
        &self,
        scope_key: &str,
        owner: &str,
        lease_seconds: i64,
    ) -> Result<bool, String> {
        let now = now_seconds();
        let expires = now.saturating_add(lease_seconds.max(1));
        let mut conn = self.open()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("begin memory phase2 lease: {error}"))?;
        let current = tx
            .query_row(
                "SELECT lease_owner, lease_expires_at, retry_at, retry_remaining FROM memory_phase2_jobs WHERE scope_key = ?1",
                params![scope_key],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("read memory phase2 lease: {error}"))?;
        if let Some((current_owner, current_expiry, retry_at, retry_remaining)) = current {
            if current_owner.as_deref() != Some(owner)
                && current_expiry.is_some_and(|expiry| expiry > now)
            {
                return Ok(false);
            }
            if retry_at.is_some_and(|retry_at| retry_at > now) || retry_remaining <= 0 {
                return Ok(false);
            }
        }
        tx.execute(
            r#"
            INSERT INTO memory_phase2_jobs
                (scope_key, status, lease_owner, lease_expires_at, retry_at, retry_remaining, updated_at)
            VALUES (?1, 'leased', ?2, ?3, NULL, 3, ?4)
            ON CONFLICT(scope_key) DO UPDATE SET
                status = 'leased',
                lease_owner = excluded.lease_owner,
                lease_expires_at = excluded.lease_expires_at,
                last_error = NULL,
                retry_at = NULL,
                updated_at = excluded.updated_at
            "#,
            params![scope_key, owner, expires, now],
        )
        .map_err(|error| format!("claim memory phase2 lease: {error}"))?;
        tx.commit()
            .map_err(|error| format!("commit memory phase2 lease: {error}"))?;
        Ok(true)
    }

    /// Extends a phase-2 lease only while the caller still owns the running job.
    pub(super) fn heartbeat_phase2(
        &self,
        scope_key: &str,
        owner: &str,
        lease_seconds: i64,
    ) -> Result<bool, String> {
        let now = now_seconds();
        let expires = now.saturating_add(lease_seconds.max(1));
        let changed = self
            .open()?
            .execute(
                r#"
                UPDATE memory_phase2_jobs
                SET lease_expires_at = ?1, updated_at = ?2
                WHERE scope_key = ?3 AND status = 'leased' AND lease_owner = ?4
                "#,
                params![expires, now, scope_key, owner],
            )
            .map_err(|error| format!("heartbeat memory phase2 lease: {error}"))?;
        Ok(changed > 0)
    }

    pub(super) fn finish_phase2(
        &self,
        scope_key: &str,
        owner: &str,
        success: bool,
        error: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.open()?;
        let status = if success { "succeeded" } else { "failed" };
        let now = now_seconds();
        conn.execute(
            r#"
            UPDATE memory_phase2_jobs
            SET status = ?1,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error = ?2,
                retry_at = CASE WHEN ?3 = 1 THEN NULL ELSE ?4 + 60 END,
                retry_remaining = CASE WHEN ?3 = 1 THEN retry_remaining ELSE MAX(retry_remaining - 1, 0) END,
                last_success_at = CASE WHEN ?3 = 1 THEN ?4 ELSE last_success_at END,
                completed_watermark = CASE WHEN ?3 = 1 THEN completed_watermark + 1 ELSE completed_watermark END,
                updated_at = ?4
            WHERE scope_key = ?5 AND lease_owner = ?6
            "#,
            params![status, error, success as i64, now, scope_key, owner],
        )
        .map_err(|error| format!("finish memory phase2 lease: {error}"))?;
        Ok(())
    }

    pub(super) fn reset_scope(&self, scope_key: &str) -> Result<(), String> {
        let conn = self.open()?;
        conn.execute(
            "DELETE FROM memory_rollout_jobs WHERE scope_key = ?1",
            params![scope_key],
        )
        .map_err(|error| format!("reset memory rollout state: {error}"))?;
        conn.execute(
            "DELETE FROM memory_phase2_jobs WHERE scope_key = ?1",
            params![scope_key],
        )
        .map_err(|error| format!("reset memory phase2 state: {error}"))?;
        Ok(())
    }

    pub(super) fn open(&self) -> Result<Connection, String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("create memory state directory: {error}"))?;
        }
        let conn = Connection::open(&self.path)
            .map_err(|error| format!("open memory state database: {error}"))?;
        conn.execute_batch(SCHEMA)
            .map_err(|error| format!("initialize memory state schema: {error}"))?;
        ensure_column(&conn, "memory_rollout_jobs", "retry_at", "INTEGER")?;
        ensure_column(&conn, "memory_rollout_jobs", "source_thread_id", "TEXT")?;
        ensure_column(
            &conn,
            "memory_rollout_jobs",
            "retry_remaining",
            "INTEGER NOT NULL DEFAULT 3",
        )?;
        ensure_column(&conn, "memory_rollout_jobs", "output_raw_memory", "TEXT")?;
        ensure_column(
            &conn,
            "memory_rollout_jobs",
            "output_rollout_summary",
            "TEXT",
        )?;
        ensure_column(&conn, "memory_rollout_jobs", "output_rollout_slug", "TEXT")?;
        ensure_column(&conn, "memory_rollout_jobs", "generated_at", "INTEGER")?;
        ensure_column(
            &conn,
            "memory_rollout_jobs",
            "usage_count",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(&conn, "memory_rollout_jobs", "last_usage", "INTEGER")?;
        ensure_column(
            &conn,
            "memory_rollout_jobs",
            "selected_for_phase2",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(&conn, "memory_rollout_jobs", "last_error", "TEXT")?;
        ensure_column(&conn, "memory_phase2_jobs", "retry_at", "INTEGER")?;
        ensure_column(
            &conn,
            "memory_phase2_jobs",
            "retry_remaining",
            "INTEGER NOT NULL DEFAULT 3",
        )?;
        ensure_column(&conn, "memory_phase2_jobs", "last_success_at", "INTEGER")?;
        Ok(conn)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct StageOneOutputSnapshot {
    pub(super) source_path: String,
    pub(super) content_hash: String,
    pub(super) source_updated_at: String,
    pub(super) raw_memory: Option<String>,
    pub(super) rollout_summary: String,
    pub(super) rollout_slug: Option<String>,
}

impl MemoryStateStore {
    /// Claims a registered stage-1 extraction job with a renewable lease.
    ///
    /// This is deliberately independent from the provider call. A caller may crash after
    /// claiming; the lease then expires and the next startup can safely retry the same source.
    pub(super) fn try_claim_stage1(
        &self,
        scope_key: &str,
        source_path: &str,
        owner: &str,
        lease_seconds: i64,
        max_running_jobs: usize,
    ) -> Result<bool, String> {
        let now = now_seconds();
        let expires = now.saturating_add(lease_seconds.max(1));
        let mut conn = self.open()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("begin memory stage1 lease: {error}"))?;
        let running: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM memory_rollout_jobs WHERE scope_key = ?1 AND status = 'leased' AND lease_expires_at > ?2",
                params![scope_key, now],
                |row| row.get(0),
            )
            .map_err(|error| format!("count memory stage1 leases: {error}"))?;
        let current = tx
            .query_row(
                "SELECT status, lease_owner, lease_expires_at, retry_at, retry_remaining FROM memory_rollout_jobs WHERE scope_key = ?1 AND source_path = ?2",
                params![scope_key, source_path],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("read memory stage1 job: {error}"))?;
        let Some((status, lease_owner, lease_expires_at, retry_at, retry_remaining)) = current
        else {
            return Err("memory stage1 source must be registered before claiming".to_string());
        };
        if status == "leased"
            && lease_owner.as_deref() != Some(owner)
            && lease_expires_at.is_some_and(|expires_at| expires_at > now)
        {
            return Ok(false);
        }
        if retry_at.is_some_and(|retry_at| retry_at > now) {
            return Ok(false);
        }
        if retry_remaining <= 0 {
            return Ok(false);
        }
        if running >= i64::try_from(max_running_jobs.max(1)).unwrap_or(i64::MAX)
            && !(status == "leased" && lease_owner.as_deref() == Some(owner))
        {
            return Ok(false);
        }
        tx.execute(
            r#"
            UPDATE memory_rollout_jobs
            SET status = 'leased',
                lease_owner = ?1,
                lease_expires_at = ?2,
                attempts = attempts + 1,
                retry_at = NULL,
                updated_at = ?3
            WHERE scope_key = ?4 AND source_path = ?5
            "#,
            params![owner, expires, now, scope_key, source_path],
        )
        .map_err(|error| format!("claim memory stage1 lease: {error}"))?;
        tx.commit()
            .map_err(|error| format!("commit memory stage1 lease: {error}"))?;
        Ok(true)
    }

    /// Atomically persists the provider output before releasing the stage-1 lease.
    pub(super) fn save_stage1_output(
        &self,
        scope_key: &str,
        source_path: &str,
        owner: &str,
        output: StageOneOutputSnapshot,
    ) -> Result<bool, String> {
        let now = now_seconds();
        let conn = self.open()?;
        let changed = conn
            .execute(
                r#"
                UPDATE memory_rollout_jobs
                SET content_hash = ?1,
                    source_updated_at = ?2,
                    status = 'pending',
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    retry_at = NULL,
                    retry_remaining = 3,
                    output_raw_memory = ?3,
                    output_rollout_summary = ?4,
                    output_rollout_slug = ?5,
                    last_error = NULL,
                    generated_at = ?6,
                    updated_at = ?6
                WHERE scope_key = ?7 AND source_path = ?8
                  AND status = 'leased' AND lease_owner = ?9
                  AND content_hash = ?1 AND source_updated_at = ?2
                "#,
                params![
                    output.content_hash,
                    output.source_updated_at,
                    output.raw_memory,
                    output.rollout_summary,
                    output.rollout_slug,
                    now,
                    scope_key,
                    source_path,
                    owner
                ],
            )
            .map_err(|error| format!("save memory stage1 output: {error}"))?;
        Ok(changed > 0)
    }

    /// Extends a stage-1 lease while a provider extraction is still running.
    pub(super) fn heartbeat_stage1(
        &self,
        scope_key: &str,
        source_path: &str,
        owner: &str,
        lease_seconds: i64,
    ) -> Result<bool, String> {
        let now = now_seconds();
        let expires = now.saturating_add(lease_seconds.max(1));
        let changed = self
            .open()?
            .execute(
                r#"
                UPDATE memory_rollout_jobs
                SET lease_expires_at = ?1, updated_at = ?2
                WHERE scope_key = ?3 AND source_path = ?4
                  AND status = 'leased' AND lease_owner = ?5
                "#,
                params![expires, now, scope_key, source_path, owner],
            )
            .map_err(|error| format!("heartbeat memory stage1 lease: {error}"))?;
        Ok(changed > 0)
    }

    pub(super) fn mark_stage1_no_output(
        &self,
        scope_key: &str,
        source_path: &str,
        owner: &str,
    ) -> Result<bool, String> {
        let changed = self
            .open()?
            .execute(
                r#"
                UPDATE memory_rollout_jobs
                SET status = 'review',
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    retry_at = NULL,
                    output_raw_memory = NULL,
                    output_rollout_summary = NULL,
                    output_rollout_slug = NULL,
                    selected_for_phase2 = 0,
                    last_error = 'no_output',
                    generated_at = ?1,
                    updated_at = ?1
                WHERE scope_key = ?2 AND source_path = ?3 AND lease_owner = ?4
                "#,
                params![now_seconds(), scope_key, source_path, owner],
            )
            .map_err(|error| format!("mark memory stage1 no output: {error}"))?;
        Ok(changed > 0)
    }

    pub(super) fn mark_stage1_failed(
        &self,
        scope_key: &str,
        source_path: &str,
        owner: &str,
        retry_after_seconds: i64,
        error: &str,
    ) -> Result<bool, String> {
        let now = now_seconds();
        let changed = self
            .open()?
            .execute(
                r#"
                UPDATE memory_rollout_jobs
                SET status = 'pending',
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    retry_at = ?1,
                    retry_remaining = MAX(retry_remaining - 1, 0),
                    last_error = ?5,
                    updated_at = ?2
                WHERE scope_key = ?3 AND source_path = ?4 AND lease_owner = ?6
                "#,
                params![
                    now.saturating_add(retry_after_seconds.max(1)),
                    now,
                    scope_key,
                    source_path,
                    error,
                    owner,
                ],
            )
            .map_err(|db_error| format!("mark memory stage1 failure ({error}): {db_error}"))?;
        Ok(changed > 0)
    }

    pub(super) fn record_stage1_usage(
        &self,
        scope_key: &str,
        source_paths: &[&str],
    ) -> Result<usize, String> {
        let now = now_seconds();
        let conn = self.open()?;
        let mut updated = 0;
        for source_path in source_paths {
            updated += conn
                .execute(
                    "UPDATE memory_rollout_jobs SET usage_count = usage_count + 1, last_usage = ?1, updated_at = ?1 WHERE scope_key = ?2 AND source_path = ?3",
                    params![now, scope_key, source_path],
                )
                .map_err(|error| format!("record memory stage1 usage: {error}"))?;
        }
        Ok(updated)
    }

    pub(super) fn record_stage1_usage_for_thread_ids(
        &self,
        scope_key: &str,
        thread_ids: &[&str],
    ) -> Result<usize, String> {
        let now = now_seconds();
        let conn = self.open()?;
        let mut updated = 0;
        for thread_id in thread_ids {
            updated += conn
                .execute(
                    "UPDATE memory_rollout_jobs SET usage_count = usage_count + 1, last_usage = ?1, updated_at = ?1 WHERE scope_key = ?2 AND source_thread_id = ?3",
                    params![now, scope_key, thread_id],
                )
                .map_err(|error| format!("record memory citation usage: {error}"))?;
        }
        Ok(updated)
    }

    /// Commit only the selected source versions, matching Codex's stage-1 snapshot identity.
    /// A newer extraction at the same path remains pending for the next phase-2 run.
    pub(super) fn commit_phase2_snapshot(
        &self,
        scope_key: &str,
        owner: &str,
        completion_watermark: i64,
        selected_sources: &[StageTwoInput],
    ) -> Result<bool, String> {
        let mut conn = self.open()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("begin memory phase2 snapshot: {error}"))?;
        let now = now_seconds();
        let updated = tx
            .execute(
                r#"
                UPDATE memory_phase2_jobs
                SET status = 'succeeded',
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    completed_watermark = MAX(completed_watermark, ?1),
                    last_error = NULL,
                    retry_at = NULL,
                    last_success_at = ?2,
                    updated_at = ?2
                WHERE scope_key = ?3 AND status = 'leased' AND lease_owner = ?4
                "#,
                params![completion_watermark, now, scope_key, owner],
            )
            .map_err(|error| format!("commit memory phase2 watermark: {error}"))?
            .gt(&0);
        if !updated {
            return Ok(false);
        }
        tx.execute(
            "UPDATE memory_rollout_jobs SET selected_for_phase2 = 0 WHERE scope_key = ?1",
            params![scope_key],
        )
        .map_err(|error| format!("clear memory phase2 selection: {error}"))?;
        for snapshot in selected_sources {
            tx.execute(
                "UPDATE memory_rollout_jobs SET status = 'consolidated', selected_for_phase2 = 1, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?1 WHERE scope_key = ?2 AND source_path = ?3 AND source_updated_at = ?4 AND content_hash = ?5",
                params![now, scope_key, snapshot.source_path, snapshot.source_updated_at, snapshot.content_hash],
            )
            .map_err(|error| format!("commit memory phase2 selection: {error}"))?;
        }
        tx.commit()
            .map_err(|error| format!("commit memory phase2 snapshot: {error}"))?;
        Ok(true)
    }
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let exists = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("inspect memory state schema: {error}"))?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("read memory state schema: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read memory state column: {error}"))?
        .into_iter()
        .any(|name| name == column);
    if !exists {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))
        .map_err(|error| format!("add memory state column {column}: {error}"))?;
    }
    Ok(())
}

pub(super) fn hash_content(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    hex::encode(digest)
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn parse_source_timestamp(value: &str) -> Option<i64> {
    value.trim().parse::<i64>().ok().or_else(|| {
        chrono::DateTime::parse_from_rfc3339(value.trim())
            .ok()
            .map(|date| date.timestamp())
    })
}

pub(super) fn source_thread_id_from_content(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        let key = key.trim().trim_start_matches('-').trim();
        if !matches!(
            key,
            "threadId" | "thread_id" | "sourceThreadId" | "source_thread_id"
        ) {
            return None;
        }
        let value = value.trim().trim_matches('`').trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

#[cfg(test)]
mod tests;
