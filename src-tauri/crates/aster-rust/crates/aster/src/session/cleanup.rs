//! Session Cleanup Support
//!
//! Provides functionality for cleaning up expired sessions and summaries.

use anyhow::Result;
use chrono::{Duration, Utc};
use serde::Serialize;
use tracing::{info, warn};

/// Default cleanup period in days
pub const DEFAULT_CLEANUP_PERIOD_DAYS: u32 = 30;

/// Cleanup statistics
#[derive(Debug, Clone, Default, Serialize)]
pub struct CleanupStats {
    /// Number of sessions cleaned
    pub sessions: usize,
    /// Number of summaries cleaned
    pub summaries: usize,
    /// Number of errors encountered
    pub errors: usize,
    /// Number of directories processed
    pub directories: usize,
}

impl CleanupStats {
    /// Check if any cleanup was performed
    pub fn has_changes(&self) -> bool {
        self.sessions > 0 || self.summaries > 0
    }
}

/// Get the cutoff date for cleanup
///
/// # Arguments
/// * `period_days` - Number of days to keep data
pub fn get_cutoff_date(period_days: u32) -> chrono::DateTime<Utc> {
    Utc::now() - Duration::days(period_days as i64)
}

/// Clean up expired summaries
///
/// # Arguments
/// * `period_days` - Number of days to keep summaries
///
/// # Returns
/// Number of summaries deleted
pub fn cleanup_summaries(period_days: u32) -> Result<usize> {
    crate::session::resume::cleanup_old_summaries(period_days)
}

/// Clean up expired data (summaries only for now)
///
/// Note: Session cleanup is handled by the database,
/// this function cleans up file-based caches.
///
/// # Arguments
/// * `period_days` - Number of days to keep data
pub fn cleanup_expired_data(period_days: u32) -> CleanupStats {
    let mut stats = CleanupStats::default();

    // Clean up summaries
    match cleanup_summaries(period_days) {
        Ok(count) => {
            stats.summaries = count;
            if count > 0 {
                stats.directories += 1;
            }
        }
        Err(e) => {
            warn!("Failed to cleanup summaries: {}", e);
            stats.errors += 1;
        }
    }

    stats
}

/// Schedule cleanup to run asynchronously
///
/// This function spawns a background task to clean up
/// expired data without blocking the main thread.
///
/// # Arguments
/// * `period_days` - Number of days to keep data
pub fn schedule_cleanup(period_days: u32) {
    tokio::spawn(async move {
        // Small delay to avoid impacting startup
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        let stats = cleanup_expired_data(period_days);

        if stats.has_changes() {
            info!("Cleanup complete: {} summaries removed", stats.summaries);
        }

        if stats.errors > 0 {
            warn!("Cleanup encountered {} errors", stats.errors);
        }
    });
}

/// Force cleanup synchronously
///
/// # Arguments
/// * `period_days` - Number of days to keep data
///
/// # Returns
/// Cleanup statistics
pub fn force_cleanup(period_days: u32) -> CleanupStats {
    let stats = cleanup_expired_data(period_days);

    info!(
        "Force cleanup complete: {} summaries removed",
        stats.summaries
    );

    if stats.errors > 0 {
        warn!("Cleanup encountered {} errors", stats.errors);
    }

    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_cutoff_date() {
        let cutoff = get_cutoff_date(30);
        let now = Utc::now();

        // Cutoff should be approximately 30 days ago
        let diff = now - cutoff;
        assert!(diff.num_days() >= 29 && diff.num_days() <= 31);
    }

    #[test]
    fn test_cleanup_stats_has_changes() {
        let empty = CleanupStats::default();
        assert!(!empty.has_changes());

        let with_sessions = CleanupStats {
            sessions: 1,
            ..Default::default()
        };
        assert!(with_sessions.has_changes());

        let with_summaries = CleanupStats {
            summaries: 1,
            ..Default::default()
        };
        assert!(with_summaries.has_changes());
    }
}
