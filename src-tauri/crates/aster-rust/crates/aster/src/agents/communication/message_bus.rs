//! Agent Message Bus
//!
//! Provides inter-agent messaging with priority queues,
//! broadcast support, and request-response patterns.
//!
//! # Features
//! - Priority-based message queuing
//! - Broadcast messaging to subscribed agents
//! - Request-response communication patterns
//! - Message expiration handling
//! - Message history for debugging

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, VecDeque};
use thiserror::Error;
use tokio::sync::oneshot;

/// Result type alias for message bus operations
pub type MessageBusResult<T> = Result<T, MessageBusError>;

/// Error types for message bus operations
#[derive(Debug, Error)]
pub enum MessageBusError {
    /// Agent not found
    #[error("Agent not found: {0}")]
    AgentNotFound(String),

    /// Queue is full
    #[error("Queue is full for agent: {0}")]
    QueueFull(String),

    /// Message expired
    #[error("Message expired: {0}")]
    MessageExpired(String),

    /// Request timeout
    #[error("Request timeout: {0}")]
    RequestTimeout(String),

    /// Invalid message
    #[error("Invalid message: {0}")]
    InvalidMessage(String),

    /// Serialization error
    #[error("Serialization error: {0}")]
    SerializationError(String),

    /// No response received
    #[error("No response received for request: {0}")]
    NoResponse(String),

    /// Response channel closed
    #[error("Response channel closed: {0}")]
    ChannelClosed(String),
}

/// Message target - either a specific agent or broadcast
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MessageTarget {
    /// Send to a specific agent
    Agent(String),
    /// Broadcast to all agents subscribed to a message type
    Broadcast,
    /// Send to multiple specific agents
    Multiple(Vec<String>),
}

impl MessageTarget {
    /// Get the agent ID if this is a single agent target
    pub fn get_agent_id(&self) -> Option<String> {
        match self {
            MessageTarget::Agent(id) => Some(id.clone()),
            _ => None,
        }
    }
}

/// Priority levels for messages
#[derive(
    Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash,
)]
#[serde(rename_all = "camelCase")]
pub enum MessagePriority {
    /// Low priority - processed last
    Low = 0,
    /// Normal priority - default
    #[default]
    Normal = 1,
    /// High priority - processed before normal
    High = 2,
    /// Critical priority - processed first
    Critical = 3,
}

impl From<u8> for MessagePriority {
    fn from(value: u8) -> Self {
        match value {
            0 => Self::Low,
            1 => Self::Normal,
            2 => Self::High,
            _ => Self::Critical,
        }
    }
}

/// Agent message structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    /// Unique message identifier
    pub id: String,
    /// Sender agent ID
    pub from: String,
    /// Target (agent ID or broadcast)
    pub to: MessageTarget,
    /// Message type for routing/filtering
    pub message_type: String,
    /// Message payload
    pub payload: Value,
    /// Creation timestamp
    pub timestamp: DateTime<Utc>,
    /// Message priority (0-255, higher = more important)
    pub priority: u8,
    /// Whether this message requires a response
    pub requires_response: bool,
    /// ID of the message this is responding to (if any)
    pub response_to_id: Option<String>,
    /// Expiration time (if any)
    pub expires_at: Option<DateTime<Utc>>,
}

impl AgentMessage {
    /// Create a new message
    pub fn new(
        from: impl Into<String>,
        to: MessageTarget,
        message_type: impl Into<String>,
        payload: Value,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            from: from.into(),
            to,
            message_type: message_type.into(),
            payload,
            timestamp: Utc::now(),
            priority: MessagePriority::Normal as u8,
            requires_response: false,
            response_to_id: None,
            expires_at: None,
        }
    }

    /// Create a broadcast message
    pub fn broadcast(
        from: impl Into<String>,
        message_type: impl Into<String>,
        payload: Value,
    ) -> Self {
        Self::new(from, MessageTarget::Broadcast, message_type, payload)
    }

    /// Set the priority
    pub fn with_priority(mut self, priority: u8) -> Self {
        self.priority = priority;
        self
    }

    /// Set whether response is required
    pub fn with_requires_response(mut self, requires: bool) -> Self {
        self.requires_response = requires;
        self
    }

    /// Set the response_to_id
    pub fn with_response_to(mut self, id: impl Into<String>) -> Self {
        self.response_to_id = Some(id.into());
        self
    }

    /// Set expiration time
    pub fn with_expiration(mut self, expires_at: DateTime<Utc>) -> Self {
        self.expires_at = Some(expires_at);
        self
    }

    /// Set expiration duration from now
    pub fn expires_in(mut self, duration: Duration) -> Self {
        self.expires_at = Some(Utc::now() + duration);
        self
    }

    /// Check if the message has expired
    pub fn is_expired(&self) -> bool {
        self.expires_at.map(|exp| Utc::now() > exp).unwrap_or(false)
    }
}

/// Wrapper for priority queue ordering (higher priority first)
#[derive(Debug, Clone)]
struct PrioritizedMessage {
    message: AgentMessage,
}

impl PartialEq for PrioritizedMessage {
    fn eq(&self, other: &Self) -> bool {
        self.message.id == other.message.id
    }
}

impl Eq for PrioritizedMessage {}

impl PartialOrd for PrioritizedMessage {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PrioritizedMessage {
    fn cmp(&self, other: &Self) -> Ordering {
        // Higher priority first, then earlier timestamp
        match self.message.priority.cmp(&other.message.priority) {
            Ordering::Equal => other.message.timestamp.cmp(&self.message.timestamp),
            other => other,
        }
    }
}

/// Message subscription configuration
#[derive(Debug, Clone)]
pub struct MessageSubscription {
    /// Agent ID
    pub agent_id: String,
    /// Message types to subscribe to (empty = all types)
    pub message_types: Vec<String>,
    /// Whether the subscription is active
    pub active: bool,
}

impl MessageSubscription {
    /// Create a new subscription
    pub fn new(agent_id: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            message_types: Vec::new(),
            active: true,
        }
    }

    /// Subscribe to specific message types
    pub fn with_types(mut self, types: Vec<String>) -> Self {
        self.message_types = types;
        self
    }

    /// Check if this subscription matches a message type
    pub fn matches(&self, message_type: &str) -> bool {
        self.active
            && (self.message_types.is_empty()
                || self.message_types.contains(&message_type.to_string()))
    }
}

/// Pending request waiting for a response
#[derive(Debug)]
#[allow(dead_code)]
struct PendingRequest {
    /// Request message ID
    request_id: String,
    /// Sender of the request
    from: String,
    /// Target agent
    to: String,
    /// When the request was sent
    sent_at: DateTime<Utc>,
    /// When the request expires
    pub expires_at: DateTime<Utc>,
    /// Channel to send the response
    pub response_sender: Option<oneshot::Sender<Value>>,
}

/// Agent Message Bus for inter-agent communication
#[derive(Debug)]
pub struct AgentMessageBus {
    /// Message queues per agent (using priority heap)
    message_queues: HashMap<String, BinaryHeap<PrioritizedMessage>>,
    /// Subscriptions per agent
    subscriptions: HashMap<String, MessageSubscription>,
    /// Message history for debugging
    message_history: VecDeque<AgentMessage>,
    /// Maximum history size
    max_history_size: usize,
    /// Maximum queue size per agent
    max_queue_size: usize,
    /// Pending requests waiting for responses (request_id -> PendingRequest)
    pending_requests: HashMap<String, PendingRequest>,
}

impl Default for AgentMessageBus {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentMessageBus {
    /// Create a new message bus with default settings
    pub fn new() -> Self {
        Self {
            message_queues: HashMap::new(),
            subscriptions: HashMap::new(),
            message_history: VecDeque::new(),
            max_history_size: 1000,
            max_queue_size: 100,
            pending_requests: HashMap::new(),
        }
    }

    /// Create a new message bus with custom settings
    pub fn with_config(max_history_size: usize, max_queue_size: usize) -> Self {
        Self {
            message_queues: HashMap::new(),
            subscriptions: HashMap::new(),
            message_history: VecDeque::new(),
            max_history_size,
            max_queue_size,
            pending_requests: HashMap::new(),
        }
    }

    /// Subscribe an agent to receive messages
    pub fn subscribe(&mut self, agent_id: impl Into<String>, types: Vec<String>) {
        let agent_id = agent_id.into();
        let subscription = MessageSubscription::new(&agent_id).with_types(types);
        self.subscriptions.insert(agent_id.clone(), subscription);
        // Ensure queue exists
        self.message_queues.entry(agent_id).or_default();
    }

    /// Unsubscribe an agent
    pub fn unsubscribe(&mut self, agent_id: &str) {
        if let Some(sub) = self.subscriptions.get_mut(agent_id) {
            sub.active = false;
        }
    }

    /// Check if an agent is subscribed
    pub fn is_subscribed(&self, agent_id: &str) -> bool {
        self.subscriptions
            .get(agent_id)
            .map(|s| s.active)
            .unwrap_or(false)
    }

    /// Get subscription for an agent
    pub fn get_subscription(&self, agent_id: &str) -> Option<&MessageSubscription> {
        self.subscriptions.get(agent_id)
    }

    /// Send a message to a specific agent or broadcast
    pub fn send(&mut self, message: AgentMessage) -> MessageBusResult<()> {
        // Check if message has expired
        if message.is_expired() {
            return Err(MessageBusError::MessageExpired(message.id.clone()));
        }

        // Add to history
        self.add_to_history(message.clone());

        // Clone target to avoid borrow issues
        let target = message.to.clone();
        match target {
            MessageTarget::Agent(agent_id) => {
                self.deliver_to_agent(&agent_id, message)?;
            }
            MessageTarget::Broadcast => {
                self.broadcast_message(message)?;
            }
            MessageTarget::Multiple(agent_ids) => {
                for agent_id in &agent_ids {
                    // Clone message for each recipient
                    self.deliver_to_agent(agent_id, message.clone())?;
                }
            }
        }

        Ok(())
    }

    /// Broadcast a message to all subscribed agents
    pub fn broadcast(
        &mut self,
        message_type: &str,
        payload: Value,
        sender: &str,
    ) -> MessageBusResult<()> {
        let message = AgentMessage::broadcast(sender, message_type, payload);
        self.send(message)
    }

    /// Deliver a message to a specific agent
    fn deliver_to_agent(&mut self, agent_id: &str, message: AgentMessage) -> MessageBusResult<()> {
        // Ensure queue exists
        let queue = self.message_queues.entry(agent_id.to_string()).or_default();

        // Check queue size limit
        if queue.len() >= self.max_queue_size {
            return Err(MessageBusError::QueueFull(agent_id.to_string()));
        }

        queue.push(PrioritizedMessage { message });
        Ok(())
    }

    /// Broadcast message to all subscribed agents
    fn broadcast_message(&mut self, message: AgentMessage) -> MessageBusResult<()> {
        let message_type = &message.message_type;
        let sender = &message.from;

        // Collect matching agents first to avoid borrow issues
        let matching_agents: Vec<String> = self
            .subscriptions
            .iter()
            .filter(|(agent_id, sub)| sub.matches(message_type) && *agent_id != sender)
            .map(|(agent_id, _)| agent_id.clone())
            .collect();

        // Deliver to each matching agent
        for agent_id in matching_agents {
            self.deliver_to_agent(&agent_id, message.clone())?;
        }

        Ok(())
    }

    /// Get all messages in an agent's queue (without removing)
    pub fn get_queue(&self, agent_id: &str) -> Vec<AgentMessage> {
        self.message_queues
            .get(agent_id)
            .map(|heap| {
                let mut messages: Vec<_> = heap.iter().map(|pm| pm.message.clone()).collect();
                // Sort by priority (highest first) then timestamp (earliest first)
                messages.sort_by(|a, b| match b.priority.cmp(&a.priority) {
                    Ordering::Equal => a.timestamp.cmp(&b.timestamp),
                    other => other,
                });
                messages
            })
            .unwrap_or_default()
    }

    /// Dequeue messages from an agent's queue (removes them)
    pub fn dequeue(&mut self, agent_id: &str, count: usize) -> Vec<AgentMessage> {
        let queue = match self.message_queues.get_mut(agent_id) {
            Some(q) => q,
            None => return Vec::new(),
        };

        let mut messages = Vec::with_capacity(count.min(queue.len()));
        for _ in 0..count {
            if let Some(pm) = queue.pop() {
                // Skip expired messages
                if !pm.message.is_expired() {
                    messages.push(pm.message);
                }
            } else {
                break;
            }
        }
        messages
    }

    /// Dequeue all messages from an agent's queue
    pub fn dequeue_all(&mut self, agent_id: &str) -> Vec<AgentMessage> {
        let queue = match self.message_queues.get_mut(agent_id) {
            Some(q) => q,
            None => return Vec::new(),
        };

        let mut messages = Vec::with_capacity(queue.len());
        while let Some(pm) = queue.pop() {
            if !pm.message.is_expired() {
                messages.push(pm.message);
            }
        }
        messages
    }

    /// Get the number of messages in an agent's queue
    pub fn queue_size(&self, agent_id: &str) -> usize {
        self.message_queues
            .get(agent_id)
            .map(|q| q.len())
            .unwrap_or(0)
    }

    /// Check if an agent has pending messages
    pub fn has_messages(&self, agent_id: &str) -> bool {
        self.queue_size(agent_id) > 0
    }

    /// Add a message to history
    fn add_to_history(&mut self, message: AgentMessage) {
        self.message_history.push_back(message);
        while self.message_history.len() > self.max_history_size {
            self.message_history.pop_front();
        }
    }

    /// Get message history
    pub fn get_history(&self, limit: Option<usize>) -> Vec<AgentMessage> {
        let limit = limit.unwrap_or(self.message_history.len());
        self.message_history
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    /// Clear message history
    pub fn clear_history(&mut self) {
        self.message_history.clear();
    }

    /// Get all subscribed agent IDs
    pub fn get_subscribed_agents(&self) -> Vec<String> {
        self.subscriptions
            .iter()
            .filter(|(_, sub)| sub.active)
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Remove expired messages from all queues
    pub fn cleanup_expired(&mut self) -> usize {
        let mut removed = 0;
        for queue in self.message_queues.values_mut() {
            let before = queue.len();
            let messages: Vec<_> = queue
                .drain()
                .filter(|pm| !pm.message.is_expired())
                .collect();
            removed += before - messages.len();
            for msg in messages {
                queue.push(msg);
            }
        }
        removed
    }

    /// Get statistics about the message bus
    pub fn stats(&self) -> MessageBusStats {
        let total_queued: usize = self.message_queues.values().map(|q| q.len()).sum();
        MessageBusStats {
            subscribed_agents: self.subscriptions.iter().filter(|(_, s)| s.active).count(),
            total_queued_messages: total_queued,
            history_size: self.message_history.len(),
            max_history_size: self.max_history_size,
            max_queue_size: self.max_queue_size,
        }
    }

    /// Send a request message and wait for a response with timeout
    ///
    /// This method sends a message to the target agent with `requires_response` set to true,
    /// and waits for a response within the specified timeout duration.
    ///
    /// # Arguments
    /// * `to` - Target agent ID
    /// * `message_type` - Type of the message
    /// * `payload` - Message payload
    /// * `from` - Sender agent ID
    /// * `timeout` - Maximum time to wait for a response
    ///
    /// # Returns
    /// * `Ok(Value)` - The response payload
    /// * `Err(MessageBusError::RequestTimeout)` - If no response is received within timeout
    /// * `Err(MessageBusError::MessageExpired)` - If the message expires before delivery
    pub fn prepare_request(
        &mut self,
        to: &str,
        message_type: &str,
        payload: Value,
        from: &str,
        timeout: Duration,
    ) -> MessageBusResult<(String, oneshot::Receiver<Value>)> {
        let expires_at = Utc::now() + timeout;

        // Create the request message
        let message = AgentMessage::new(
            from,
            MessageTarget::Agent(to.to_string()),
            message_type,
            payload,
        )
        .with_requires_response(true)
        .with_expiration(expires_at);

        let request_id = message.id.clone();

        // Create a channel for the response
        let (tx, rx) = oneshot::channel();

        // Store the pending request
        let pending = PendingRequest {
            request_id: request_id.clone(),
            from: from.to_string(),
            to: to.to_string(),
            sent_at: Utc::now(),
            expires_at,
            response_sender: Some(tx),
        };
        self.pending_requests.insert(request_id.clone(), pending);

        // Send the message
        self.send(message)?;

        Ok((request_id, rx))
    }

    /// Send a response to a request message
    ///
    /// This method sends a response to a previously received request message.
    /// The response is delivered to the original requester.
    ///
    /// # Arguments
    /// * `request` - The original request message
    /// * `payload` - Response payload
    ///
    /// # Returns
    /// * `Ok(())` - If the response was sent successfully
    /// * `Err(MessageBusError::InvalidMessage)` - If the request doesn't require a response
    /// * `Err(MessageBusError::NoResponse)` - If no pending request was found
    pub fn respond(&mut self, request: &AgentMessage, payload: Value) -> MessageBusResult<()> {
        // Verify the request requires a response
        if !request.requires_response {
            return Err(MessageBusError::InvalidMessage(
                "Request does not require a response".to_string(),
            ));
        }

        // Check if there's a pending request
        if let Some(mut pending) = self.pending_requests.remove(&request.id) {
            // Check if the request has expired
            if Utc::now() > pending.expires_at {
                return Err(MessageBusError::RequestTimeout(request.id.clone()));
            }

            // Send the response through the channel
            if let Some(sender) = pending.response_sender.take() {
                sender
                    .send(payload.clone())
                    .map_err(|_| MessageBusError::ChannelClosed(request.id.clone()))?;
            }

            // Also create a response message for history/queue
            let response_message = AgentMessage::new(
                request.to.get_agent_id().unwrap_or_default(),
                MessageTarget::Agent(request.from.clone()),
                format!("{}_response", request.message_type),
                payload,
            )
            .with_response_to(&request.id);

            // Add to history
            self.add_to_history(response_message.clone());

            // Deliver to the original sender's queue
            self.deliver_to_agent(&request.from, response_message)?;

            Ok(())
        } else {
            Err(MessageBusError::NoResponse(request.id.clone()))
        }
    }

    /// Check if a request is still pending
    pub fn is_request_pending(&self, request_id: &str) -> bool {
        self.pending_requests.contains_key(request_id)
    }

    /// Get the number of pending requests
    pub fn pending_request_count(&self) -> usize {
        self.pending_requests.len()
    }

    /// Cancel a pending request
    ///
    /// Removes the pending request without sending a response.
    /// Returns true if the request was found and cancelled.
    pub fn cancel_request(&mut self, request_id: &str) -> bool {
        self.pending_requests.remove(request_id).is_some()
    }

    /// Cleanup expired pending requests
    ///
    /// Removes all pending requests that have exceeded their timeout.
    /// Returns the number of expired requests removed.
    pub fn cleanup_expired_requests(&mut self) -> usize {
        let now = Utc::now();
        let expired_ids: Vec<String> = self
            .pending_requests
            .iter()
            .filter(|(_, req)| now > req.expires_at)
            .map(|(id, _)| id.clone())
            .collect();

        let count = expired_ids.len();
        for id in expired_ids {
            self.pending_requests.remove(&id);
        }
        count
    }

    /// Get a response message from an agent's queue by request ID
    ///
    /// Searches the agent's queue for a response to the specified request.
    /// Returns and removes the response message if found.
    pub fn get_response(&mut self, agent_id: &str, request_id: &str) -> Option<AgentMessage> {
        let queue = self.message_queues.get_mut(agent_id)?;

        // Find and remove the response message
        let messages: Vec<PrioritizedMessage> = queue.drain().collect();
        let mut response = None;
        let mut remaining = Vec::new();

        for pm in messages {
            if pm.message.response_to_id.as_deref() == Some(request_id) {
                response = Some(pm.message);
            } else {
                remaining.push(pm);
            }
        }

        // Put back the remaining messages
        for pm in remaining {
            queue.push(pm);
        }

        response
    }

    /// Find a message in history by ID
    pub fn find_message_in_history(&self, message_id: &str) -> Option<&AgentMessage> {
        self.message_history.iter().find(|m| m.id == message_id)
    }

    /// Get all response messages for a specific request from history
    pub fn get_responses_from_history(&self, request_id: &str) -> Vec<&AgentMessage> {
        self.message_history
            .iter()
            .filter(|m| m.response_to_id.as_deref() == Some(request_id))
            .collect()
    }
}

/// Statistics about the message bus
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageBusStats {
    /// Number of subscribed agents
    pub subscribed_agents: usize,
    /// Total messages across all queues
    pub total_queued_messages: usize,
    /// Current history size
    pub history_size: usize,
    /// Maximum history size
    pub max_history_size: usize,
    /// Maximum queue size per agent
    pub max_queue_size: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::sync::oneshot;

    #[test]
    fn test_message_creation() {
        let msg = AgentMessage::new(
            "agent-1",
            MessageTarget::Agent("agent-2".to_string()),
            "test-type",
            json!({"data": "value"}),
        );

        assert!(!msg.id.is_empty());
        assert_eq!(msg.from, "agent-1");
        assert_eq!(msg.to, MessageTarget::Agent("agent-2".to_string()));
        assert_eq!(msg.message_type, "test-type");
        assert_eq!(msg.priority, MessagePriority::Normal as u8);
        assert!(!msg.requires_response);
        assert!(msg.response_to_id.is_none());
        assert!(msg.expires_at.is_none());
    }

    #[test]
    fn test_message_broadcast_creation() {
        let msg = AgentMessage::broadcast("agent-1", "broadcast-type", json!({"key": "value"}));

        assert_eq!(msg.to, MessageTarget::Broadcast);
        assert_eq!(msg.message_type, "broadcast-type");
    }

    #[test]
    fn test_message_with_priority() {
        let msg = AgentMessage::new(
            "agent-1",
            MessageTarget::Agent("agent-2".to_string()),
            "test",
            json!({}),
        )
        .with_priority(MessagePriority::Critical as u8);

        assert_eq!(msg.priority, MessagePriority::Critical as u8);
    }

    #[test]
    fn test_message_expiration() {
        let expired_msg = AgentMessage::new(
            "agent-1",
            MessageTarget::Agent("agent-2".to_string()),
            "test",
            json!({}),
        )
        .with_expiration(Utc::now() - Duration::seconds(10));

        assert!(expired_msg.is_expired());

        let valid_msg = AgentMessage::new(
            "agent-1",
            MessageTarget::Agent("agent-2".to_string()),
            "test",
            json!({}),
        )
        .expires_in(Duration::hours(1));

        assert!(!valid_msg.is_expired());
    }

    #[test]
    fn test_message_bus_subscribe() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec!["type-a".to_string(), "type-b".to_string()]);

        assert!(bus.is_subscribed("agent-1"));
        assert!(!bus.is_subscribed("agent-2"));

        let sub = bus.get_subscription("agent-1").unwrap();
        assert!(sub.matches("type-a"));
        assert!(sub.matches("type-b"));
        assert!(!sub.matches("type-c"));
    }

    #[test]
    fn test_message_bus_subscribe_all_types() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]); // Empty = all types

        let sub = bus.get_subscription("agent-1").unwrap();
        assert!(sub.matches("any-type"));
        assert!(sub.matches("another-type"));
    }

    #[test]
    fn test_message_bus_unsubscribe() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);
        assert!(bus.is_subscribed("agent-1"));

        bus.unsubscribe("agent-1");
        assert!(!bus.is_subscribed("agent-1"));
    }

    #[test]
    fn test_message_bus_send_to_agent() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-2", vec![]);

        let msg = AgentMessage::new(
            "agent-1",
            MessageTarget::Agent("agent-2".to_string()),
            "test",
            json!({"data": 123}),
        );

        bus.send(msg).unwrap();

        assert_eq!(bus.queue_size("agent-2"), 1);
        assert!(bus.has_messages("agent-2"));
    }

    #[test]
    fn test_message_bus_broadcast() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec!["broadcast-type".to_string()]);
        bus.subscribe("agent-2", vec!["broadcast-type".to_string()]);
        bus.subscribe("agent-3", vec!["other-type".to_string()]);

        bus.broadcast("broadcast-type", json!({"msg": "hello"}), "sender")
            .unwrap();

        // agent-1 and agent-2 should receive (subscribed to broadcast-type)
        // agent-3 should not receive (subscribed to other-type)
        assert_eq!(bus.queue_size("agent-1"), 1);
        assert_eq!(bus.queue_size("agent-2"), 1);
        assert_eq!(bus.queue_size("agent-3"), 0);
    }

    #[test]
    fn test_message_bus_priority_ordering() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);

        // Send messages with different priorities
        let low = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({"priority": "low"}),
        )
        .with_priority(MessagePriority::Low as u8);

        let high = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({"priority": "high"}),
        )
        .with_priority(MessagePriority::High as u8);

        let normal = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({"priority": "normal"}),
        )
        .with_priority(MessagePriority::Normal as u8);

        let critical = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({"priority": "critical"}),
        )
        .with_priority(MessagePriority::Critical as u8);

        // Send in random order
        bus.send(low).unwrap();
        bus.send(high).unwrap();
        bus.send(normal).unwrap();
        bus.send(critical).unwrap();

        // Dequeue should return in priority order
        let messages = bus.dequeue("agent-1", 4);
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].priority, MessagePriority::Critical as u8);
        assert_eq!(messages[1].priority, MessagePriority::High as u8);
        assert_eq!(messages[2].priority, MessagePriority::Normal as u8);
        assert_eq!(messages[3].priority, MessagePriority::Low as u8);
    }

    #[test]
    fn test_message_bus_dequeue() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);

        for i in 0..5 {
            let msg = AgentMessage::new(
                "sender",
                MessageTarget::Agent("agent-1".to_string()),
                "test",
                json!({"index": i}),
            );
            bus.send(msg).unwrap();
        }

        assert_eq!(bus.queue_size("agent-1"), 5);

        let messages = bus.dequeue("agent-1", 3);
        assert_eq!(messages.len(), 3);
        assert_eq!(bus.queue_size("agent-1"), 2);

        let remaining = bus.dequeue_all("agent-1");
        assert_eq!(remaining.len(), 2);
        assert_eq!(bus.queue_size("agent-1"), 0);
    }

    #[test]
    fn test_message_bus_queue_full() {
        let mut bus = AgentMessageBus::with_config(100, 2); // Max 2 messages per queue
        bus.subscribe("agent-1", vec![]);

        let msg1 = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({}),
        );
        let msg2 = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({}),
        );
        let msg3 = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({}),
        );

        bus.send(msg1).unwrap();
        bus.send(msg2).unwrap();

        // Third message should fail
        let result = bus.send(msg3);
        assert!(matches!(result, Err(MessageBusError::QueueFull(_))));
    }

    #[test]
    fn test_message_bus_expired_message() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);

        let expired = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({}),
        )
        .with_expiration(Utc::now() - Duration::seconds(10));

        let result = bus.send(expired);
        assert!(matches!(result, Err(MessageBusError::MessageExpired(_))));
    }

    #[test]
    fn test_message_bus_history() {
        let mut bus = AgentMessageBus::with_config(5, 100); // Max 5 history entries
        bus.subscribe("agent-1", vec![]);

        for i in 0..10 {
            let msg = AgentMessage::new(
                "sender",
                MessageTarget::Agent("agent-1".to_string()),
                "test",
                json!({"index": i}),
            );
            bus.send(msg).unwrap();
        }

        let history = bus.get_history(None);
        assert_eq!(history.len(), 5); // Limited to max_history_size

        let limited = bus.get_history(Some(3));
        assert_eq!(limited.len(), 3);
    }

    #[test]
    fn test_message_bus_stats() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);
        bus.subscribe("agent-2", vec![]);

        let msg = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({}),
        );
        bus.send(msg).unwrap();

        let stats = bus.stats();
        assert_eq!(stats.subscribed_agents, 2);
        assert_eq!(stats.total_queued_messages, 1);
        assert_eq!(stats.history_size, 1);
    }

    #[test]
    fn test_message_bus_get_subscribed_agents() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);
        bus.subscribe("agent-2", vec![]);
        bus.subscribe("agent-3", vec![]);
        bus.unsubscribe("agent-2");

        let agents = bus.get_subscribed_agents();
        assert_eq!(agents.len(), 2);
        assert!(agents.contains(&"agent-1".to_string()));
        assert!(agents.contains(&"agent-3".to_string()));
        assert!(!agents.contains(&"agent-2".to_string()));
    }

    #[test]
    fn test_prepare_request() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);
        bus.subscribe("agent-2", vec![]);

        let (request_id, _rx) = bus
            .prepare_request(
                "agent-2",
                "query",
                json!({"question": "hello?"}),
                "agent-1",
                Duration::seconds(30),
            )
            .unwrap();

        // Request should be pending
        assert!(bus.is_request_pending(&request_id));
        assert_eq!(bus.pending_request_count(), 1);

        // Message should be in agent-2's queue
        assert_eq!(bus.queue_size("agent-2"), 1);

        let messages = bus.get_queue("agent-2");
        assert_eq!(messages[0].message_type, "query");
        assert!(messages[0].requires_response);
    }

    #[test]
    fn test_respond_to_request() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);
        bus.subscribe("agent-2", vec![]);

        // Prepare a request
        let (request_id, _rx) = bus
            .prepare_request(
                "agent-2",
                "query",
                json!({"question": "hello?"}),
                "agent-1",
                Duration::seconds(30),
            )
            .unwrap();

        // Get the request message from agent-2's queue
        let messages = bus.dequeue("agent-2", 1);
        let request = &messages[0];

        // Respond to the request
        bus.respond(request, json!({"answer": "world!"})).unwrap();

        // Request should no longer be pending
        assert!(!bus.is_request_pending(&request_id));

        // Response should be in agent-1's queue
        assert_eq!(bus.queue_size("agent-1"), 1);

        let responses = bus.get_queue("agent-1");
        assert_eq!(responses[0].message_type, "query_response");
        assert_eq!(responses[0].response_to_id, Some(request_id));
    }

    #[test]
    fn test_respond_to_non_request() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);
        bus.subscribe("agent-2", vec![]);

        // Send a regular message (not a request)
        let msg = AgentMessage::new(
            "agent-1",
            MessageTarget::Agent("agent-2".to_string()),
            "info",
            json!({"data": "test"}),
        );
        bus.send(msg).unwrap();

        // Get the message
        let messages = bus.dequeue("agent-2", 1);
        let message = &messages[0];

        // Trying to respond should fail
        let result = bus.respond(message, json!({"response": "test"}));
        assert!(matches!(result, Err(MessageBusError::InvalidMessage(_))));
    }

    #[test]
    fn test_cancel_request() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);
        bus.subscribe("agent-2", vec![]);

        let (request_id, _rx) = bus
            .prepare_request(
                "agent-2",
                "query",
                json!({}),
                "agent-1",
                Duration::seconds(30),
            )
            .unwrap();

        assert!(bus.is_request_pending(&request_id));

        // Cancel the request
        assert!(bus.cancel_request(&request_id));
        assert!(!bus.is_request_pending(&request_id));

        // Cancelling again should return false
        assert!(!bus.cancel_request(&request_id));
    }

    #[test]
    fn test_cleanup_expired_requests() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);
        bus.subscribe("agent-2", vec![]);

        // Create a request with very short timeout (already expired)
        let expires_at = Utc::now() - Duration::seconds(1);
        let message = AgentMessage::new(
            "agent-1",
            MessageTarget::Agent("agent-2".to_string()),
            "query",
            json!({}),
        )
        .with_requires_response(true)
        .with_expiration(expires_at);

        let request_id = message.id.clone();
        let (tx, _rx) = oneshot::channel();

        // Manually insert an expired pending request
        bus.pending_requests.insert(
            request_id.clone(),
            PendingRequest {
                request_id: request_id.clone(),
                from: "agent-1".to_string(),
                to: "agent-2".to_string(),
                sent_at: Utc::now() - Duration::seconds(10),
                expires_at,
                response_sender: Some(tx),
            },
        );

        assert_eq!(bus.pending_request_count(), 1);

        // Cleanup expired requests
        let cleaned = bus.cleanup_expired_requests();
        assert_eq!(cleaned, 1);
        assert_eq!(bus.pending_request_count(), 0);
    }

    #[test]
    fn test_get_response_from_queue() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);
        bus.subscribe("agent-2", vec![]);

        // Prepare a request
        let (request_id, _rx) = bus
            .prepare_request(
                "agent-2",
                "query",
                json!({}),
                "agent-1",
                Duration::seconds(30),
            )
            .unwrap();

        // Get and respond to the request
        let messages = bus.dequeue("agent-2", 1);
        bus.respond(&messages[0], json!({"answer": "test"}))
            .unwrap();

        // Get the response from agent-1's queue
        let response = bus.get_response("agent-1", &request_id);
        assert!(response.is_some());
        let response = response.unwrap();
        assert_eq!(response.response_to_id, Some(request_id.clone()));

        // Response should be removed from queue
        assert!(bus.get_response("agent-1", &request_id).is_none());
    }

    #[test]
    fn test_find_message_in_history() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);

        let msg = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({}),
        );
        let msg_id = msg.id.clone();
        bus.send(msg).unwrap();

        // Find the message in history
        let found = bus.find_message_in_history(&msg_id);
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, msg_id);

        // Non-existent message
        assert!(bus.find_message_in_history("non-existent").is_none());
    }

    #[test]
    fn test_get_responses_from_history() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);
        bus.subscribe("agent-2", vec![]);

        // Prepare a request
        let (request_id, _rx) = bus
            .prepare_request(
                "agent-2",
                "query",
                json!({}),
                "agent-1",
                Duration::seconds(30),
            )
            .unwrap();

        // Respond to the request
        let messages = bus.dequeue("agent-2", 1);
        bus.respond(&messages[0], json!({"answer": "test"}))
            .unwrap();

        // Get responses from history
        let responses = bus.get_responses_from_history(&request_id);
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].response_to_id, Some(request_id));
    }

    #[test]
    fn test_message_target_get_agent_id() {
        let agent_target = MessageTarget::Agent("agent-1".to_string());
        assert_eq!(agent_target.get_agent_id(), Some("agent-1".to_string()));

        let broadcast_target = MessageTarget::Broadcast;
        assert_eq!(broadcast_target.get_agent_id(), None);

        let multiple_target = MessageTarget::Multiple(vec!["a".to_string(), "b".to_string()]);
        assert_eq!(multiple_target.get_agent_id(), None);
    }

    #[test]
    fn test_cleanup_expired_messages() {
        let mut bus = AgentMessageBus::new();
        bus.subscribe("agent-1", vec![]);

        // Send a message that will expire
        let msg = AgentMessage::new(
            "sender",
            MessageTarget::Agent("agent-1".to_string()),
            "test",
            json!({}),
        )
        .with_expiration(Utc::now() - Duration::seconds(1)); // Already expired

        // Manually add to queue (bypassing expiration check in send)
        bus.message_queues
            .entry("agent-1".to_string())
            .or_default()
            .push(PrioritizedMessage { message: msg });

        assert_eq!(bus.queue_size("agent-1"), 1);

        // Cleanup expired messages
        let removed = bus.cleanup_expired();
        assert_eq!(removed, 1);
        assert_eq!(bus.queue_size("agent-1"), 0);
    }
}
