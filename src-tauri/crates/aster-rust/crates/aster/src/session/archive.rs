//! Session Archive Support
//!
//! Provides functionality for archiving sessions.

use crate::config::paths::Paths;
use crate::session::SessionManager;
use anyhow::Result;
use std::fs;
use std::path::PathBuf;
use tracing::info;

/// Get the archive directory path
fn get_archive_dir() -> PathBuf {
    Paths::data_dir().join("sessions").join("archive")
}

/// Ensure the archive directory exists
fn ensure_archive_dir() -> Result<PathBuf> {
    let dir = get_archive_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// Archive a session by exporting it to the archive directory
///
/// Note: Since sessions are stored in SQLite, archiving exports
/// the session to a JSON file in the archive directory.
///
/// # Arguments
/// * `session_id` - The session ID to archive
///
/// # Returns
/// The path to the archived session file
pub async fn archive_session(session_id: &str) -> Result<PathBuf> {
    let archive_dir = ensure_archive_dir()?;

    // Export session to JSON
    let json = SessionManager::export_session(session_id).await?;

    // Write to archive file
    let archive_path = archive_dir.join(format!("{}.json", session_id));
    fs::write(&archive_path, &json)?;

    info!(
        "Session {} archived to {}",
        session_id,
        archive_path.display()
    );

    Ok(archive_path)
}

/// Archive and delete a session
///
/// Archives the session first, then deletes it from the database.
///
/// # Arguments
/// * `session_id` - The session ID to archive and delete
pub async fn archive_and_delete_session(session_id: &str) -> Result<PathBuf> {
    let archive_path = archive_session(session_id).await?;
    SessionManager::delete_session(session_id).await?;
    info!("Session {} deleted after archiving", session_id);
    Ok(archive_path)
}

/// Bulk archive sessions
///
/// # Arguments
/// * `session_ids` - List of session IDs to archive
///
/// # Returns
/// Results for each session (archived path or error)
pub async fn bulk_archive_sessions(session_ids: &[String]) -> BulkArchiveResult {
    let mut result = BulkArchiveResult::default();

    for id in session_ids {
        match archive_session(id).await {
            Ok(path) => {
                result.archived.push((id.clone(), path));
            }
            Err(e) => {
                result.failed.push((id.clone(), e.to_string()));
            }
        }
    }

    result
}

/// Result of bulk archive operation
#[derive(Debug, Default)]
pub struct BulkArchiveResult {
    /// Successfully archived sessions with their paths
    pub archived: Vec<(String, PathBuf)>,
    /// Failed sessions with error messages
    pub failed: Vec<(String, String)>,
}

impl BulkArchiveResult {
    /// Check if all archives succeeded
    pub fn all_succeeded(&self) -> bool {
        self.failed.is_empty()
    }

    /// Get count of successful archives
    pub fn success_count(&self) -> usize {
        self.archived.len()
    }

    /// Get count of failed archives
    pub fn failure_count(&self) -> usize {
        self.failed.len()
    }
}

/// List archived sessions
///
/// # Returns
/// List of archived session IDs
pub fn list_archived_sessions() -> Result<Vec<String>> {
    let archive_dir = get_archive_dir();

    if !archive_dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();

    for entry in fs::read_dir(&archive_dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.extension().is_some_and(|ext| ext == "json") {
            if let Some(stem) = path.file_stem() {
                sessions.push(stem.to_string_lossy().to_string());
            }
        }
    }

    Ok(sessions)
}

/// Restore an archived session
///
/// # Arguments
/// * `session_id` - The archived session ID to restore
pub async fn restore_archived_session(session_id: &str) -> Result<crate::session::Session> {
    let archive_dir = get_archive_dir();
    let archive_path = archive_dir.join(format!("{}.json", session_id));

    if !archive_path.exists() {
        anyhow::bail!("Archived session not found: {}", session_id);
    }

    let json = fs::read_to_string(&archive_path)?;
    let session = SessionManager::import_session(&json).await?;

    // Remove from archive after successful restore
    fs::remove_file(&archive_path)?;

    info!("Session {} restored from archive", session_id);

    Ok(session)
}

/// Delete an archived session permanently
///
/// # Arguments
/// * `session_id` - The archived session ID to delete
pub fn delete_archived_session(session_id: &str) -> Result<()> {
    let archive_dir = get_archive_dir();
    let archive_path = archive_dir.join(format!("{}.json", session_id));

    if archive_path.exists() {
        fs::remove_file(&archive_path)?;
        info!("Archived session {} deleted", session_id);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bulk_archive_result() {
        let mut result = BulkArchiveResult::default();
        assert!(result.all_succeeded());
        assert_eq!(result.success_count(), 0);

        result
            .archived
            .push(("test1".to_string(), PathBuf::from("/tmp/test1.json")));
        assert!(result.all_succeeded());
        assert_eq!(result.success_count(), 1);

        result
            .failed
            .push(("test2".to_string(), "error".to_string()));
        assert!(!result.all_succeeded());
        assert_eq!(result.failure_count(), 1);
    }
}
