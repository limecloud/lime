//! Session Resume Support
//!
//! Provides functionality for saving and loading session summaries,
//! enabling context continuation when sessions run out of context.

use crate::config::paths::Paths;
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Summary cache data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryCacheData {
    /// Session UUID
    pub uuid: String,
    /// Summary text
    pub summary: String,
    /// Timestamp when summary was created
    pub timestamp: DateTime<Utc>,
    /// Number of conversation turns summarized
    pub turn_count: Option<usize>,
}

/// Get the summaries directory path
fn get_summaries_dir() -> PathBuf {
    Paths::data_dir().join("sessions").join("summaries")
}

/// Ensure the summaries directory exists
fn ensure_summaries_dir() -> Result<PathBuf> {
    let dir = get_summaries_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// Save a summary to cache
///
/// # Arguments
/// * `session_id` - The session ID
/// * `summary` - The summary text
/// * `turn_count` - Optional number of turns summarized
pub fn save_summary(session_id: &str, summary: &str, turn_count: Option<usize>) -> Result<()> {
    let dir = ensure_summaries_dir()?;
    let file_path = dir.join(format!("{}.json", session_id));

    let data = SummaryCacheData {
        uuid: session_id.to_string(),
        summary: summary.to_string(),
        timestamp: Utc::now(),
        turn_count,
    };

    let json = serde_json::to_string_pretty(&data)?;
    fs::write(&file_path, json)?;

    Ok(())
}

/// Load a summary from cache
///
/// # Arguments
/// * `session_id` - The session ID
///
/// # Returns
/// The summary text if found, None otherwise
pub fn load_summary(session_id: &str) -> Option<String> {
    let dir = get_summaries_dir();
    let file_path = dir.join(format!("{}.json", session_id));

    if !file_path.exists() {
        return None;
    }

    match fs::read_to_string(&file_path) {
        Ok(content) => match serde_json::from_str::<SummaryCacheData>(&content) {
            Ok(data) => Some(data.summary),
            Err(e) => {
                tracing::warn!("Failed to parse summary for session {}: {}", session_id, e);
                None
            }
        },
        Err(e) => {
            tracing::warn!("Failed to read summary for session {}: {}", session_id, e);
            None
        }
    }
}

/// Load full summary cache data
///
/// # Arguments
/// * `session_id` - The session ID
///
/// # Returns
/// The full summary cache data if found
pub fn load_summary_data(session_id: &str) -> Option<SummaryCacheData> {
    let dir = get_summaries_dir();
    let file_path = dir.join(format!("{}.json", session_id));

    if !file_path.exists() {
        return None;
    }

    fs::read_to_string(&file_path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
}

/// Check if a session has a cached summary
///
/// # Arguments
/// * `session_id` - The session ID
pub fn has_summary(session_id: &str) -> bool {
    let dir = get_summaries_dir();
    let file_path = dir.join(format!("{}.json", session_id));
    file_path.exists()
}

/// Delete a summary from cache
///
/// # Arguments
/// * `session_id` - The session ID
pub fn delete_summary(session_id: &str) -> Result<()> {
    let dir = get_summaries_dir();
    let file_path = dir.join(format!("{}.json", session_id));

    if file_path.exists() {
        fs::remove_file(&file_path)?;
    }

    Ok(())
}

/// List all cached summaries
///
/// # Returns
/// A vector of summary cache data
pub fn list_summaries() -> Vec<SummaryCacheData> {
    let dir = get_summaries_dir();

    if !dir.exists() {
        return Vec::new();
    }

    let mut summaries = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(data) = serde_json::from_str::<SummaryCacheData>(&content) {
                        summaries.push(data);
                    }
                }
            }
        }
    }

    // Sort by timestamp, newest first
    summaries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    summaries
}

/// Build a resume message for continuing a session
///
/// When a session's context overflows and needs to continue,
/// this message informs the AI about the previous conversation.
///
/// # Arguments
/// * `summary` - The conversation summary
/// * `is_non_interactive` - Whether this is a non-interactive session
///
/// # Returns
/// The resume message text
pub fn build_resume_message(summary: &str, is_non_interactive: bool) -> String {
    let base = format!(
        "This session is being continued from a previous conversation that ran out of context. \
         The conversation is summarized below:\n{}",
        summary
    );

    if is_non_interactive {
        // Non-interactive mode: just add the summary
        base
    } else {
        // Interactive mode: add continuation instructions
        format!(
            "{}\n\nPlease continue the conversation from where we left it off \
             without asking the user any further questions. \
             Continue with the last task that you were asked to work on.",
            base
        )
    }
}

/// Clean up old summaries
///
/// # Arguments
/// * `max_age_days` - Maximum age in days for summaries to keep
///
/// # Returns
/// Number of summaries deleted
pub fn cleanup_old_summaries(max_age_days: u32) -> Result<usize> {
    let dir = get_summaries_dir();

    if !dir.exists() {
        return Ok(0);
    }

    let cutoff = Utc::now() - chrono::Duration::days(max_age_days as i64);
    let mut deleted = 0;

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(data) = serde_json::from_str::<SummaryCacheData>(&content) {
                        if data.timestamp < cutoff && fs::remove_file(&path).is_ok() {
                            deleted += 1;
                        }
                    }
                }
            }
        }
    }

    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use tempfile::TempDir;

    #[test]
    fn test_build_resume_message_interactive() {
        let summary = "User asked about Rust programming. Assistant explained ownership.";
        let message = build_resume_message(summary, false);

        assert!(message.contains(summary));
        assert!(message.contains("continue the conversation"));
        assert!(message.contains("without asking the user"));
    }

    #[test]
    fn test_build_resume_message_non_interactive() {
        let summary = "User asked about Rust programming.";
        let message = build_resume_message(summary, true);

        assert!(message.contains(summary));
        assert!(!message.contains("without asking the user"));
    }

    #[test]
    fn test_summary_cache_data_serialization() {
        let data = SummaryCacheData {
            uuid: "test_session_123".to_string(),
            summary: "Test summary content".to_string(),
            timestamp: Utc::now(),
            turn_count: Some(10),
        };

        let json = serde_json::to_string(&data).unwrap();
        let deserialized: SummaryCacheData = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.uuid, data.uuid);
        assert_eq!(deserialized.summary, data.summary);
        assert_eq!(deserialized.turn_count, Some(10));
    }
}
