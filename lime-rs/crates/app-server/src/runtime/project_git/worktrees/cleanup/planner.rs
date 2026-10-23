//! 同一资格规则用于候选排序与删除前的保留数量复核。
use std::path::{Path, PathBuf};

const HOUR_MS: i64 = 3_600_000;
const MIGRATION_CUTOFF_MS: i64 = 1_771_632_000_000;
pub(crate) const BUFFER_MS: i64 = 5 * 24 * HOUR_MS;

#[derive(Debug)]
pub(super) struct Candidate {
    pub path: PathBuf,
    pub owned: bool,
    pub created_at_ms: Option<i64>,
    pub updated_at_ms: i64,
    pub protected: bool,
}

fn eligible(record: &Candidate, now: i64, buffer: bool) -> bool {
    !record.protected
        && (record.owned
            || !record.created_at_ms.is_some_and(|created| {
                now.saturating_sub(created) < HOUR_MS || (buffer && created < MIGRATION_CUTOFF_MS)
            }))
}

pub(super) fn permits_removal(
    records: &[Candidate],
    target: &Path,
    keep_count: u32,
    now: i64,
    buffer: bool,
) -> bool {
    records
        .iter()
        .any(|record| record.path == target && eligible(record, now, buffer))
        && records
            .iter()
            .filter(|record| eligible(record, now, buffer))
            .count()
            > keep_count as usize
}

pub(super) fn plan(
    mut records: Vec<Candidate>,
    keep_count: u32,
    now: i64,
    buffer: bool,
) -> Vec<PathBuf> {
    records.retain(|record| eligible(record, now, buffer));
    records.sort_by(|left, right| {
        left.owned
            .cmp(&right.owned)
            .then_with(|| {
                if left.owned {
                    left.updated_at_ms.cmp(&right.updated_at_ms)
                } else {
                    left.created_at_ms
                        .unwrap_or(i64::MAX)
                        .cmp(&right.created_at_ms.unwrap_or(i64::MAX))
                }
            })
            .then_with(|| left.path.cmp(&right.path))
    });
    let count = records.len().saturating_sub(keep_count as usize);
    records
        .into_iter()
        .take(count)
        .map(|record| record.path)
        .collect()
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
