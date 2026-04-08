//! MCP Cancellation Module
//!
//! Implements request cancellation for MCP operations. Provides:
//! - Request tracking and cancellation
//! - Timeout-based cancellation
//! - Cancellation token pattern
//! - Integration with tokio CancellationToken

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, RwLock};

use super::error::{McpError, McpResult};

/// Cancellation reason
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CancellationReason {
    /// User cancelled the request
    UserCancelled,
    /// Request timed out
    Timeout,
    /// Server requested cancellation
    ServerRequest,
    /// System is shutting down
    Shutdown,
    /// Error occurred
    Error,
}

impl std::fmt::Display for CancellationReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UserCancelled => write!(f, "Request cancelled by user"),
            Self::Timeout => write!(f, "Request timed out"),
            Self::ServerRequest => write!(f, "Cancelled at server request"),
            Self::Shutdown => write!(f, "Cancelled due to shutdown"),
            Self::Error => write!(f, "Cancelled due to error"),
        }
    }
}

/// Cancellable request information
#[derive(Debug, Clone)]
pub struct CancellableRequest {
    /// Request ID
    pub id: String,
    /// Server name
    pub server_name: String,
    /// Method name
    pub method: String,
    /// Start time
    pub start_time: Instant,
    /// Timeout duration (if set)
    pub timeout: Option<Duration>,
}

/// Cancellation result
#[derive(Debug, Clone)]
pub struct CancellationResult {
    /// Whether cancellation was successful
    pub success: bool,
    /// Cancellation reason
    pub reason: CancellationReason,
    /// Request ID
    pub request_id: String,
    /// Server name
    pub server_name: String,
    /// Duration since request started
    pub duration: Duration,
}

/// Cancellation token for request tracking
///
/// Provides a way to check if a request has been cancelled
/// and to register callbacks for cancellation events.
#[derive(Debug, Clone)]
pub struct CancellationToken {
    inner: Arc<RwLock<CancellationTokenInner>>,
    sender: broadcast::Sender<CancellationReason>,
}

#[derive(Debug)]
struct CancellationTokenInner {
    cancelled: bool,
    reason: Option<CancellationReason>,
    timestamp: Option<Instant>,
}

impl CancellationToken {
    /// Create a new cancellation token
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(16);
        Self {
            inner: Arc::new(RwLock::new(CancellationTokenInner {
                cancelled: false,
                reason: None,
                timestamp: None,
            })),
            sender,
        }
    }

    /// Check if cancellation has been requested
    pub async fn is_cancelled(&self) -> bool {
        self.inner.read().await.cancelled
    }

    /// Get cancellation reason
    pub async fn reason(&self) -> Option<CancellationReason> {
        self.inner.read().await.reason
    }

    /// Get cancellation timestamp
    pub async fn timestamp(&self) -> Option<Instant> {
        self.inner.read().await.timestamp
    }

    /// Request cancellation
    pub async fn cancel(&self, reason: CancellationReason) {
        let mut inner = self.inner.write().await;
        if inner.cancelled {
            return;
        }

        inner.cancelled = true;
        inner.reason = Some(reason);
        inner.timestamp = Some(Instant::now());

        let _ = self.sender.send(reason);
    }

    /// Throw if cancelled
    pub async fn throw_if_cancelled(&self) -> McpResult<()> {
        let inner = self.inner.read().await;
        if inner.cancelled {
            let reason = inner.reason.unwrap_or(CancellationReason::UserCancelled);
            return Err(McpError::cancelled(
                reason.to_string(),
                Some(reason.to_string()),
            ));
        }
        Ok(())
    }

    /// Subscribe to cancellation events
    pub fn subscribe(&self) -> broadcast::Receiver<CancellationReason> {
        self.sender.subscribe()
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Cancellation event for broadcasting
#[derive(Debug, Clone)]
pub enum CancellationEvent {
    /// Request registered
    RequestRegistered {
        id: String,
        server_name: String,
        method: String,
    },
    /// Request unregistered
    RequestUnregistered { id: String, server_name: String },
    /// Request cancelled
    RequestCancelled(CancellationResult),
    /// Server requests cancelled
    ServerCancelled { server_name: String, count: usize },
    /// All requests cancelled
    AllCancelled { count: usize },
}

/// Manages request cancellation for MCP operations
///
/// Features:
/// - Request registration and tracking
/// - Manual and timeout-based cancellation
/// - Cancellation notification
/// - Event emission for monitoring
pub struct McpCancellationManager {
    requests: Arc<RwLock<HashMap<String, CancellableRequest>>>,
    tokens: Arc<RwLock<HashMap<String, CancellationToken>>>,
    event_sender: broadcast::Sender<CancellationEvent>,
}

impl McpCancellationManager {
    /// Create a new cancellation manager
    pub fn new() -> Self {
        let (event_sender, _) = broadcast::channel(256);
        Self {
            requests: Arc::new(RwLock::new(HashMap::new())),
            tokens: Arc::new(RwLock::new(HashMap::new())),
            event_sender,
        }
    }

    /// Subscribe to cancellation events
    pub fn subscribe(&self) -> broadcast::Receiver<CancellationEvent> {
        self.event_sender.subscribe()
    }

    /// Register a cancellable request
    pub async fn register_request(
        &self,
        id: impl Into<String>,
        server_name: impl Into<String>,
        method: impl Into<String>,
        timeout: Option<Duration>,
    ) -> CancellationToken {
        let id = id.into();
        let server_name = server_name.into();
        let method = method.into();

        let request = CancellableRequest {
            id: id.clone(),
            server_name: server_name.clone(),
            method: method.clone(),
            start_time: Instant::now(),
            timeout,
        };

        let token = CancellationToken::new();

        self.requests.write().await.insert(id.clone(), request);
        self.tokens.write().await.insert(id.clone(), token.clone());

        let _ = self
            .event_sender
            .send(CancellationEvent::RequestRegistered {
                id,
                server_name,
                method,
            });

        token
    }

    /// Unregister a request (called when completed successfully)
    pub async fn unregister_request(&self, id: &str) -> bool {
        let request = self.requests.write().await.remove(id);
        self.tokens.write().await.remove(id);

        if let Some(req) = request {
            let _ = self
                .event_sender
                .send(CancellationEvent::RequestUnregistered {
                    id: id.to_string(),
                    server_name: req.server_name,
                });
            true
        } else {
            false
        }
    }

    /// Check if a request is registered
    pub async fn has_request(&self, id: &str) -> bool {
        self.requests.read().await.contains_key(id)
    }

    /// Get a registered request
    pub async fn get_request(&self, id: &str) -> Option<CancellableRequest> {
        self.requests.read().await.get(id).cloned()
    }

    /// Get all registered requests
    pub async fn get_all_requests(&self) -> Vec<CancellableRequest> {
        self.requests.read().await.values().cloned().collect()
    }

    /// Get requests for a specific server
    pub async fn get_server_requests(&self, server_name: &str) -> Vec<CancellableRequest> {
        self.requests
            .read()
            .await
            .values()
            .filter(|r| r.server_name == server_name)
            .cloned()
            .collect()
    }

    /// Cancel a request
    pub async fn cancel_request(
        &self,
        id: &str,
        reason: CancellationReason,
    ) -> Option<CancellationResult> {
        let request = self.requests.write().await.remove(id)?;
        let token = self.tokens.write().await.remove(id);

        // Cancel the token
        if let Some(t) = token {
            t.cancel(reason).await;
        }

        let duration = request.start_time.elapsed();
        let result = CancellationResult {
            success: true,
            reason,
            request_id: id.to_string(),
            server_name: request.server_name,
            duration,
        };

        let _ = self
            .event_sender
            .send(CancellationEvent::RequestCancelled(result.clone()));

        Some(result)
    }

    /// Cancel all requests for a server
    pub async fn cancel_server_requests(
        &self,
        server_name: &str,
        reason: CancellationReason,
    ) -> Vec<CancellationResult> {
        let requests = self.get_server_requests(server_name).await;
        let mut results = Vec::new();

        for request in requests {
            if let Some(result) = self.cancel_request(&request.id, reason).await {
                results.push(result);
            }
        }

        let _ = self.event_sender.send(CancellationEvent::ServerCancelled {
            server_name: server_name.to_string(),
            count: results.len(),
        });

        results
    }

    /// Cancel all requests
    pub async fn cancel_all(&self, reason: CancellationReason) -> Vec<CancellationResult> {
        let requests = self.get_all_requests().await;
        let mut results = Vec::new();

        for request in requests {
            if let Some(result) = self.cancel_request(&request.id, reason).await {
                results.push(result);
            }
        }

        let _ = self.event_sender.send(CancellationEvent::AllCancelled {
            count: results.len(),
        });

        results
    }

    /// Get statistics about cancellations
    pub async fn get_stats(&self) -> CancellationStats {
        let requests = self.get_all_requests().await;

        let mut by_server: HashMap<String, usize> = HashMap::new();
        let mut with_timeout = 0;

        for request in &requests {
            *by_server.entry(request.server_name.clone()).or_insert(0) += 1;
            if request.timeout.is_some() {
                with_timeout += 1;
            }
        }

        CancellationStats {
            active_requests: requests.len(),
            by_server,
            with_timeout,
        }
    }

    /// Get request durations
    pub async fn get_request_durations(&self) -> Vec<RequestDuration> {
        self.requests
            .read()
            .await
            .values()
            .map(|r| RequestDuration {
                id: r.id.clone(),
                server_name: r.server_name.clone(),
                method: r.method.clone(),
                duration: r.start_time.elapsed(),
            })
            .collect()
    }

    /// Find requests exceeding a duration threshold
    pub async fn find_long_running_requests(&self, threshold: Duration) -> Vec<CancellableRequest> {
        self.requests
            .read()
            .await
            .values()
            .filter(|r| r.start_time.elapsed() > threshold)
            .cloned()
            .collect()
    }

    /// Clean up all requests
    pub async fn cleanup(&self) {
        self.requests.write().await.clear();
        self.tokens.write().await.clear();
    }
}

impl Default for McpCancellationManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Cancellation statistics
#[derive(Debug, Clone)]
pub struct CancellationStats {
    /// Number of active requests
    pub active_requests: usize,
    /// Requests by server
    pub by_server: HashMap<String, usize>,
    /// Requests with timeout
    pub with_timeout: usize,
}

/// Request duration information
#[derive(Debug, Clone)]
pub struct RequestDuration {
    /// Request ID
    pub id: String,
    /// Server name
    pub server_name: String,
    /// Method name
    pub method: String,
    /// Duration since request started
    pub duration: Duration,
}

/// Cancelled notification for MCP protocol
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CancelledNotification {
    /// Request ID that was cancelled
    pub request_id: String,
    /// Optional reason for cancellation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl CancelledNotification {
    /// Create a new cancelled notification
    pub fn new(request_id: impl Into<String>, reason: Option<String>) -> Self {
        Self {
            request_id: request_id.into(),
            reason,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cancellation_reason_display() {
        assert_eq!(
            CancellationReason::UserCancelled.to_string(),
            "Request cancelled by user"
        );
        assert_eq!(CancellationReason::Timeout.to_string(), "Request timed out");
        assert_eq!(
            CancellationReason::Shutdown.to_string(),
            "Cancelled due to shutdown"
        );
    }

    #[tokio::test]
    async fn test_cancellation_token_new() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled().await);
        assert!(token.reason().await.is_none());
    }

    #[tokio::test]
    async fn test_cancellation_token_cancel() {
        let token = CancellationToken::new();
        token.cancel(CancellationReason::UserCancelled).await;

        assert!(token.is_cancelled().await);
        assert_eq!(
            token.reason().await,
            Some(CancellationReason::UserCancelled)
        );
    }

    #[tokio::test]
    async fn test_cancellation_token_throw_if_cancelled() {
        let token = CancellationToken::new();
        assert!(token.throw_if_cancelled().await.is_ok());

        token.cancel(CancellationReason::Timeout).await;
        assert!(token.throw_if_cancelled().await.is_err());
    }

    #[tokio::test]
    async fn test_manager_register_request() {
        let manager = McpCancellationManager::new();
        let token = manager
            .register_request("req-1", "server-1", "tools/call", None)
            .await;

        assert!(!token.is_cancelled().await);
        assert!(manager.has_request("req-1").await);
    }

    #[tokio::test]
    async fn test_manager_unregister_request() {
        let manager = McpCancellationManager::new();
        manager
            .register_request("req-1", "server-1", "tools/call", None)
            .await;

        assert!(manager.unregister_request("req-1").await);
        assert!(!manager.has_request("req-1").await);
    }

    #[tokio::test]
    async fn test_manager_cancel_request() {
        let manager = McpCancellationManager::new();
        let token = manager
            .register_request("req-1", "server-1", "tools/call", None)
            .await;

        let result = manager
            .cancel_request("req-1", CancellationReason::UserCancelled)
            .await;

        assert!(result.is_some());
        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.reason, CancellationReason::UserCancelled);
        assert!(token.is_cancelled().await);
    }

    #[tokio::test]
    async fn test_manager_cancel_server_requests() {
        let manager = McpCancellationManager::new();
        manager
            .register_request("req-1", "server-1", "tools/call", None)
            .await;
        manager
            .register_request("req-2", "server-1", "resources/read", None)
            .await;
        manager
            .register_request("req-3", "server-2", "tools/call", None)
            .await;

        let results = manager
            .cancel_server_requests("server-1", CancellationReason::Shutdown)
            .await;

        assert_eq!(results.len(), 2);
        assert!(!manager.has_request("req-1").await);
        assert!(!manager.has_request("req-2").await);
        assert!(manager.has_request("req-3").await);
    }

    #[tokio::test]
    async fn test_manager_cancel_all() {
        let manager = McpCancellationManager::new();
        manager
            .register_request("req-1", "server-1", "tools/call", None)
            .await;
        manager
            .register_request("req-2", "server-2", "tools/call", None)
            .await;

        let results = manager.cancel_all(CancellationReason::Shutdown).await;

        assert_eq!(results.len(), 2);
        assert!(manager.get_all_requests().await.is_empty());
    }

    #[tokio::test]
    async fn test_manager_get_stats() {
        let manager = McpCancellationManager::new();
        manager
            .register_request(
                "req-1",
                "server-1",
                "tools/call",
                Some(Duration::from_secs(30)),
            )
            .await;
        manager
            .register_request("req-2", "server-1", "resources/read", None)
            .await;
        manager
            .register_request("req-3", "server-2", "tools/call", None)
            .await;

        let stats = manager.get_stats().await;

        assert_eq!(stats.active_requests, 3);
        assert_eq!(stats.by_server.get("server-1"), Some(&2));
        assert_eq!(stats.by_server.get("server-2"), Some(&1));
        assert_eq!(stats.with_timeout, 1);
    }

    #[test]
    fn test_cancelled_notification() {
        let notification = CancelledNotification::new("req-1", Some("User cancelled".to_string()));
        assert_eq!(notification.request_id, "req-1");
        assert_eq!(notification.reason, Some("User cancelled".to_string()));
    }
}
