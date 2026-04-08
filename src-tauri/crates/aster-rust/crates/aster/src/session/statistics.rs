//! Session Statistics Support
//!
//! Provides detailed statistics and reporting for sessions.

use crate::session::{Session, SessionManager};
use anyhow::Result;
use serde::Serialize;
use std::collections::HashMap;

/// Detailed session statistics
#[derive(Debug, Clone, Serialize)]
pub struct SessionStatistics {
    /// Total number of sessions
    pub total_sessions: usize,
    /// Total messages across all sessions
    pub total_messages: usize,
    /// Total tokens used
    pub total_tokens: i64,
    /// Average messages per session
    pub average_messages: f64,
    /// Average tokens per session
    pub average_tokens: f64,
    /// Session type distribution
    pub type_distribution: HashMap<String, usize>,
    /// Oldest session info
    pub oldest_session: Option<SessionSummary>,
    /// Newest session info
    pub newest_session: Option<SessionSummary>,
    /// Most active session (by message count)
    pub most_active_session: Option<SessionSummary>,
}

/// Brief session summary for statistics
#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub name: String,
    pub message_count: usize,
    pub total_tokens: Option<i32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<&Session> for SessionSummary {
    fn from(session: &Session) -> Self {
        Self {
            id: session.id.clone(),
            name: session.name.clone(),
            message_count: session.message_count,
            total_tokens: session.total_tokens,
            created_at: session.created_at,
            updated_at: session.updated_at,
        }
    }
}

/// Calculate statistics from a list of sessions
pub fn calculate_statistics(sessions: &[Session]) -> SessionStatistics {
    let total_sessions = sessions.len();

    if total_sessions == 0 {
        return SessionStatistics {
            total_sessions: 0,
            total_messages: 0,
            total_tokens: 0,
            average_messages: 0.0,
            average_tokens: 0.0,
            type_distribution: HashMap::new(),
            oldest_session: None,
            newest_session: None,
            most_active_session: None,
        };
    }

    let mut total_messages = 0usize;
    let mut total_tokens = 0i64;
    let mut type_distribution: HashMap<String, usize> = HashMap::new();

    let mut oldest: Option<&Session> = None;
    let mut newest: Option<&Session> = None;
    let mut most_active: Option<&Session> = None;

    for session in sessions {
        total_messages += session.message_count;
        total_tokens += session.total_tokens.unwrap_or(0) as i64;

        // Type distribution
        let type_str = session.session_type.to_string();
        *type_distribution.entry(type_str).or_insert(0) += 1;

        // Track oldest
        if oldest.is_none() || session.created_at < oldest.unwrap().created_at {
            oldest = Some(session);
        }

        // Track newest
        if newest.is_none() || session.updated_at > newest.unwrap().updated_at {
            newest = Some(session);
        }

        // Track most active
        if most_active.is_none() || session.message_count > most_active.unwrap().message_count {
            most_active = Some(session);
        }
    }

    SessionStatistics {
        total_sessions,
        total_messages,
        total_tokens,
        average_messages: total_messages as f64 / total_sessions as f64,
        average_tokens: total_tokens as f64 / total_sessions as f64,
        type_distribution,
        oldest_session: oldest.map(SessionSummary::from),
        newest_session: newest.map(SessionSummary::from),
        most_active_session: most_active.map(SessionSummary::from),
    }
}

/// Get statistics for all sessions
pub async fn get_all_statistics() -> Result<SessionStatistics> {
    let sessions = SessionManager::list_sessions().await?;
    Ok(calculate_statistics(&sessions))
}

/// Generate a text report of session statistics
pub fn generate_report(stats: &SessionStatistics) -> String {
    let mut lines = Vec::new();

    lines.push("=".repeat(60));
    lines.push("SESSION REPORT".to_string());
    lines.push("=".repeat(60));
    lines.push(String::new());
    lines.push(format!("Generated: {}", chrono::Utc::now().to_rfc3339()));
    lines.push(String::new());

    lines.push("Statistics:".to_string());
    lines.push(format!("  Total Sessions: {}", stats.total_sessions));
    lines.push(format!("  Total Messages: {}", stats.total_messages));
    lines.push(format!("  Total Tokens: {}", stats.total_tokens));
    lines.push(String::new());
    lines.push(format!(
        "  Average Messages per Session: {:.2}",
        stats.average_messages
    ));
    lines.push(format!(
        "  Average Tokens per Session: {:.2}",
        stats.average_tokens
    ));
    lines.push(String::new());

    if !stats.type_distribution.is_empty() {
        lines.push("Session Type Distribution:".to_string());
        for (type_name, count) in &stats.type_distribution {
            let pct = (*count as f64 / stats.total_sessions as f64) * 100.0;
            lines.push(format!("  {}: {} ({:.1}%)", type_name, count, pct));
        }
        lines.push(String::new());
    }

    if let Some(oldest) = &stats.oldest_session {
        lines.push("Oldest Session:".to_string());
        lines.push(format!("  ID: {}", oldest.id));
        lines.push(format!("  Created: {}", oldest.created_at));
        lines.push(String::new());
    }

    if let Some(newest) = &stats.newest_session {
        lines.push("Newest Session:".to_string());
        lines.push(format!("  ID: {}", newest.id));
        lines.push(format!("  Updated: {}", newest.updated_at));
        lines.push(String::new());
    }

    if let Some(active) = &stats.most_active_session {
        lines.push("Most Active Session:".to_string());
        lines.push(format!("  ID: {}", active.id));
        lines.push(format!("  Messages: {}", active.message_count));
        lines.push(String::new());
    }

    lines.push("=".repeat(60));

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_statistics() {
        let stats = calculate_statistics(&[]);
        assert_eq!(stats.total_sessions, 0);
        assert_eq!(stats.total_messages, 0);
        assert!(stats.oldest_session.is_none());
    }

    #[test]
    fn test_generate_report() {
        let stats = SessionStatistics {
            total_sessions: 10,
            total_messages: 100,
            total_tokens: 50000,
            average_messages: 10.0,
            average_tokens: 5000.0,
            type_distribution: HashMap::from([("user".to_string(), 10)]),
            oldest_session: None,
            newest_session: None,
            most_active_session: None,
        };

        let report = generate_report(&stats);
        assert!(report.contains("Total Sessions: 10"));
        assert!(report.contains("Total Messages: 100"));
    }
}
