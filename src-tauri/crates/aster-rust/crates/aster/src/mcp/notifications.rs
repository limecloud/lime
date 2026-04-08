//! MCP Notifications Module
//!
//! Handles notification messages from MCP servers. Notifications are one-way
//! messages that don't require a response, used for:
//! - Progress updates
//! - Resource/tool/prompt list changes
//! - Request cancellations
//! - Custom server events

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{broadcast, RwLock};

/// Notification types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationType {
    /// Progress update
    Progress,
    /// Request cancelled
    Cancelled,
    /// Resources list changed
    ResourcesListChanged,
    /// Resources updated
    ResourcesUpdated,
    /// Tools list changed
    ToolsListChanged,
    /// Prompts list changed
    PromptsListChanged,
    /// Roots list changed
    RootsListChanged,
    /// Custom notification
    Custom,
}

impl std::fmt::Display for NotificationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Progress => write!(f, "progress"),
            Self::Cancelled => write!(f, "cancelled"),
            Self::ResourcesListChanged => write!(f, "resources/list_changed"),
            Self::ResourcesUpdated => write!(f, "resources/updated"),
            Self::ToolsListChanged => write!(f, "tools/list_changed"),
            Self::PromptsListChanged => write!(f, "prompts/list_changed"),
            Self::RootsListChanged => write!(f, "roots/list_changed"),
            Self::Custom => write!(f, "custom"),
        }
    }
}

/// Base notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    /// Notification type
    pub notification_type: NotificationType,
    /// Server name
    pub server_name: String,
    /// Timestamp
    pub timestamp: DateTime<Utc>,
    /// Method name
    pub method: String,
    /// Optional parameters
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// Progress notification parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressNotification {
    /// Progress token
    pub progress_token: String,
    /// Current progress value
    pub progress: u64,
    /// Total value (if known)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

/// Progress state tracking
#[derive(Debug, Clone)]
pub struct ProgressState {
    /// Server name
    pub server_name: String,
    /// Progress token
    pub token: String,
    /// Current progress
    pub progress: u64,
    /// Total (if known)
    pub total: Option<u64>,
    /// Start time
    pub start_time: Instant,
    /// Last update time
    pub last_update: Instant,
}

/// Notification event for broadcasting
#[derive(Debug, Clone)]
pub enum NotificationEvent {
    /// General notification received
    Notification(Notification),
    /// Progress update
    Progress {
        server_name: String,
        token: String,
        progress: u64,
        total: Option<u64>,
    },
    /// Progress completed
    ProgressComplete { server_name: String, token: String },
    /// Request cancelled
    Cancelled {
        server_name: String,
        request_id: String,
        reason: Option<String>,
    },
    /// List changed
    ListChanged {
        server_name: String,
        list_type: NotificationType,
    },
    /// Resource updated
    ResourceUpdated { server_name: String, uri: String },
    /// History cleared
    HistoryCleared { count: usize },
}

/// Manages notifications from MCP servers
pub struct McpNotificationManager {
    history: Arc<RwLock<Vec<Notification>>>,
    progress_states: Arc<RwLock<HashMap<String, ProgressState>>>,
    max_history_size: usize,
    event_sender: broadcast::Sender<NotificationEvent>,
}

impl McpNotificationManager {
    /// Create a new notification manager
    pub fn new(max_history_size: usize) -> Self {
        let (event_sender, _) = broadcast::channel(256);
        Self {
            history: Arc::new(RwLock::new(Vec::new())),
            progress_states: Arc::new(RwLock::new(HashMap::new())),
            max_history_size,
            event_sender,
        }
    }

    /// Subscribe to notification events
    pub fn subscribe(&self) -> broadcast::Receiver<NotificationEvent> {
        self.event_sender.subscribe()
    }

    /// Handle a notification from a server
    pub async fn handle_notification(
        &self,
        server_name: &str,
        method: &str,
        params: Option<serde_json::Value>,
    ) {
        let notification_type = Self::get_notification_type(method);

        let notification = Notification {
            notification_type,
            server_name: server_name.to_string(),
            timestamp: Utc::now(),
            method: method.to_string(),
            params: params.clone(),
        };

        // Add to history
        self.add_to_history(notification.clone()).await;

        // Emit general event
        let _ = self
            .event_sender
            .send(NotificationEvent::Notification(notification.clone()));

        // Handle specific types
        self.handle_specific_type(server_name, notification_type, params)
            .await;
    }

    /// Get notification type from method name
    fn get_notification_type(method: &str) -> NotificationType {
        match method {
            "notifications/progress" => NotificationType::Progress,
            "notifications/cancelled" => NotificationType::Cancelled,
            "notifications/resources/list_changed" => NotificationType::ResourcesListChanged,
            "notifications/resources/updated" => NotificationType::ResourcesUpdated,
            "notifications/tools/list_changed" => NotificationType::ToolsListChanged,
            "notifications/prompts/list_changed" => NotificationType::PromptsListChanged,
            m if m.contains("roots/list_changed") => NotificationType::RootsListChanged,
            _ => NotificationType::Custom,
        }
    }

    /// Handle specific notification types
    async fn handle_specific_type(
        &self,
        server_name: &str,
        notification_type: NotificationType,
        params: Option<serde_json::Value>,
    ) {
        match notification_type {
            NotificationType::Progress => {
                if let Some(params) = params {
                    self.handle_progress(server_name, params).await;
                }
            }
            NotificationType::Cancelled => {
                if let Some(params) = params {
                    self.handle_cancelled(server_name, params).await;
                }
            }
            NotificationType::ResourcesListChanged
            | NotificationType::ToolsListChanged
            | NotificationType::PromptsListChanged
            | NotificationType::RootsListChanged => {
                let _ = self.event_sender.send(NotificationEvent::ListChanged {
                    server_name: server_name.to_string(),
                    list_type: notification_type,
                });
            }
            NotificationType::ResourcesUpdated => {
                if let Some(params) = params {
                    if let Some(uri) = params.get("uri").and_then(|v| v.as_str()) {
                        let _ = self.event_sender.send(NotificationEvent::ResourceUpdated {
                            server_name: server_name.to_string(),
                            uri: uri.to_string(),
                        });
                    }
                }
            }
            NotificationType::Custom => {}
        }
    }

    /// Handle progress notification
    async fn handle_progress(&self, server_name: &str, params: serde_json::Value) {
        let progress_token = params
            .get("progressToken")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let progress = params.get("progress").and_then(|v| v.as_u64()).unwrap_or(0);
        let total = params.get("total").and_then(|v| v.as_u64());

        let key = format!("{}:{}", server_name, progress_token);
        let now = Instant::now();

        let mut states = self.progress_states.write().await;
        let start_time = states.get(&key).map(|e| e.start_time).unwrap_or(now);

        states.insert(
            key.clone(),
            ProgressState {
                server_name: server_name.to_string(),
                token: progress_token.clone(),
                progress,
                total,
                start_time,
                last_update: now,
            },
        );

        let _ = self.event_sender.send(NotificationEvent::Progress {
            server_name: server_name.to_string(),
            token: progress_token.clone(),
            progress,
            total,
        });

        // Check if complete
        let is_complete = total.map(|t| progress >= t).unwrap_or(false) || progress == 100;
        if is_complete {
            states.remove(&key);
            let _ = self.event_sender.send(NotificationEvent::ProgressComplete {
                server_name: server_name.to_string(),
                token: progress_token,
            });
        }
    }

    /// Handle cancelled notification
    async fn handle_cancelled(&self, server_name: &str, params: serde_json::Value) {
        let request_id = params
            .get("requestId")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let reason = params
            .get("reason")
            .and_then(|v| v.as_str())
            .map(String::from);

        let _ = self.event_sender.send(NotificationEvent::Cancelled {
            server_name: server_name.to_string(),
            request_id,
            reason,
        });
    }

    /// Add notification to history
    async fn add_to_history(&self, notification: Notification) {
        let mut history = self.history.write().await;
        history.push(notification);

        if history.len() > self.max_history_size {
            history.remove(0);
        }
    }

    /// Get notification history
    pub async fn get_history(&self, filter: Option<NotificationFilter>) -> Vec<Notification> {
        let history = self.history.read().await;
        let mut filtered: Vec<_> = history.iter().cloned().collect();

        if let Some(f) = filter {
            if let Some(server_name) = f.server_name {
                filtered.retain(|n| n.server_name == server_name);
            }
            if let Some(notification_type) = f.notification_type {
                filtered.retain(|n| n.notification_type == notification_type);
            }
            if let Some(since) = f.since {
                filtered.retain(|n| n.timestamp >= since);
            }
            if let Some(limit) = f.limit {
                let len = filtered.len();
                if len > limit {
                    filtered = filtered.into_iter().skip(len - limit).collect();
                }
            }
        }

        filtered
    }

    /// Clear history
    pub async fn clear_history(&self) {
        let mut history = self.history.write().await;
        let count = history.len();
        history.clear();
        let _ = self
            .event_sender
            .send(NotificationEvent::HistoryCleared { count });
    }

    /// Clear history for a specific server
    pub async fn clear_server_history(&self, server_name: &str) -> usize {
        let mut history = self.history.write().await;
        let before = history.len();
        history.retain(|n| n.server_name != server_name);
        before - history.len()
    }

    /// Get active progress operations
    pub async fn get_active_progress(&self) -> Vec<ProgressState> {
        self.progress_states
            .read()
            .await
            .values()
            .cloned()
            .collect()
    }

    /// Get progress for a specific server
    pub async fn get_server_progress(&self, server_name: &str) -> Vec<ProgressState> {
        self.progress_states
            .read()
            .await
            .values()
            .filter(|p| p.server_name == server_name)
            .cloned()
            .collect()
    }

    /// Cancel progress tracking for a token
    pub async fn cancel_progress(&self, server_name: &str, token: &str) -> bool {
        let key = format!("{}:{}", server_name, token);
        self.progress_states.write().await.remove(&key).is_some()
    }

    /// Clear all progress tracking
    pub async fn clear_progress(&self) {
        self.progress_states.write().await.clear();
    }

    /// Get statistics
    pub async fn get_stats(&self) -> NotificationStats {
        let history = self.history.read().await;

        let mut by_type: HashMap<NotificationType, usize> = HashMap::new();
        let mut by_server: HashMap<String, usize> = HashMap::new();

        for notification in history.iter() {
            *by_type.entry(notification.notification_type).or_insert(0) += 1;
            *by_server
                .entry(notification.server_name.clone())
                .or_insert(0) += 1;
        }

        NotificationStats {
            total_notifications: history.len(),
            max_history_size: self.max_history_size,
            active_progress: self.progress_states.read().await.len(),
            by_type,
            by_server,
        }
    }
}

impl Default for McpNotificationManager {
    fn default() -> Self {
        Self::new(100)
    }
}

/// Filter for notification history
#[derive(Debug, Clone, Default)]
pub struct NotificationFilter {
    /// Filter by server name
    pub server_name: Option<String>,
    /// Filter by notification type
    pub notification_type: Option<NotificationType>,
    /// Filter by timestamp (since)
    pub since: Option<DateTime<Utc>>,
    /// Limit number of results
    pub limit: Option<usize>,
}

/// Notification statistics
#[derive(Debug, Clone)]
pub struct NotificationStats {
    /// Total notifications in history
    pub total_notifications: usize,
    /// Maximum history size
    pub max_history_size: usize,
    /// Active progress operations
    pub active_progress: usize,
    /// Notifications by type
    pub by_type: HashMap<NotificationType, usize>,
    /// Notifications by server
    pub by_server: HashMap<String, usize>,
}

/// Create progress notification parameters
pub fn create_progress_params(
    token: &str,
    progress: u64,
    total: Option<u64>,
) -> ProgressNotification {
    ProgressNotification {
        progress_token: token.to_string(),
        progress,
        total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_notification_type_display() {
        assert_eq!(NotificationType::Progress.to_string(), "progress");
        assert_eq!(
            NotificationType::ToolsListChanged.to_string(),
            "tools/list_changed"
        );
    }

    #[test]
    fn test_get_notification_type() {
        assert_eq!(
            McpNotificationManager::get_notification_type("notifications/progress"),
            NotificationType::Progress
        );
        assert_eq!(
            McpNotificationManager::get_notification_type("notifications/tools/list_changed"),
            NotificationType::ToolsListChanged
        );
        assert_eq!(
            McpNotificationManager::get_notification_type("custom/event"),
            NotificationType::Custom
        );
    }

    #[tokio::test]
    async fn test_handle_notification() {
        let manager = McpNotificationManager::new(100);

        manager
            .handle_notification("test-server", "notifications/tools/list_changed", None)
            .await;

        let history = manager.get_history(None).await;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].server_name, "test-server");
        assert_eq!(
            history[0].notification_type,
            NotificationType::ToolsListChanged
        );
    }

    #[tokio::test]
    async fn test_handle_progress() {
        let manager = McpNotificationManager::new(100);

        let params = serde_json::json!({
            "progressToken": "token-1",
            "progress": 50,
            "total": 100
        });

        manager
            .handle_notification("test-server", "notifications/progress", Some(params))
            .await;

        let progress = manager.get_active_progress().await;
        assert_eq!(progress.len(), 1);
        assert_eq!(progress[0].progress, 50);
        assert_eq!(progress[0].total, Some(100));
    }

    #[tokio::test]
    async fn test_progress_complete() {
        let manager = McpNotificationManager::new(100);

        let params = serde_json::json!({
            "progressToken": "token-1",
            "progress": 100,
            "total": 100
        });

        manager
            .handle_notification("test-server", "notifications/progress", Some(params))
            .await;

        // Progress should be removed when complete
        let progress = manager.get_active_progress().await;
        assert!(progress.is_empty());
    }

    #[tokio::test]
    async fn test_history_filter() {
        let manager = McpNotificationManager::new(100);

        manager
            .handle_notification("server-1", "notifications/progress", None)
            .await;
        manager
            .handle_notification("server-2", "notifications/tools/list_changed", None)
            .await;
        manager
            .handle_notification("server-1", "notifications/cancelled", None)
            .await;

        let filter = NotificationFilter {
            server_name: Some("server-1".to_string()),
            ..Default::default()
        };

        let history = manager.get_history(Some(filter)).await;
        assert_eq!(history.len(), 2);
    }

    #[tokio::test]
    async fn test_clear_history() {
        let manager = McpNotificationManager::new(100);

        manager
            .handle_notification("test-server", "notifications/progress", None)
            .await;
        manager
            .handle_notification("test-server", "notifications/cancelled", None)
            .await;

        manager.clear_history().await;

        let history = manager.get_history(None).await;
        assert!(history.is_empty());
    }

    #[tokio::test]
    async fn test_get_stats() {
        let manager = McpNotificationManager::new(100);

        manager
            .handle_notification("server-1", "notifications/progress", None)
            .await;
        manager
            .handle_notification("server-1", "notifications/progress", None)
            .await;
        manager
            .handle_notification("server-2", "notifications/tools/list_changed", None)
            .await;

        let stats = manager.get_stats().await;
        assert_eq!(stats.total_notifications, 3);
        assert_eq!(stats.by_server.get("server-1"), Some(&2));
        assert_eq!(stats.by_server.get("server-2"), Some(&1));
    }

    #[test]
    fn test_create_progress_params() {
        let params = create_progress_params("token-1", 50, Some(100));
        assert_eq!(params.progress_token, "token-1");
        assert_eq!(params.progress, 50);
        assert_eq!(params.total, Some(100));
    }
}
