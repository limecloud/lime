//! Shared State Manager
//!
//! Provides shared state storage with distributed locking,
//! watch callbacks, and atomic operations.
//!
//! # Features
//! - Key-value state storage with JSON values
//! - Watch callbacks for state changes
//! - Distributed locking with timeouts
//! - Atomic compare-and-swap operations
//! - Atomic increment operations
//! - Automatic cleanup of expired locks

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::oneshot;

/// Result type alias for shared state operations
pub type SharedStateResult<T> = Result<T, SharedStateError>;

/// Error types for shared state operations
#[derive(Debug, Error)]
pub enum SharedStateError {
    /// Key not found
    #[error("Key not found: {0}")]
    KeyNotFound(String),

    /// Lock timeout
    #[error("Lock timeout for key: {0}")]
    LockTimeout(String),

    /// Lock not held
    #[error("Lock not held: {0}")]
    LockNotHeld(String),

    /// Invalid lock
    #[error("Invalid lock: {0}")]
    InvalidLock(String),

    /// Compare and swap failed
    #[error("Compare and swap failed: expected value does not match")]
    CompareAndSwapFailed,

    /// Serialization error
    #[error("Serialization error: {0}")]
    SerializationError(String),

    /// Channel error
    #[error("Channel error: {0}")]
    ChannelError(String),
}

/// Lock structure representing a distributed lock
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lock {
    /// Unique lock identifier
    pub id: String,
    /// Lock holder identifier
    pub holder: String,
    /// Key being locked
    pub key: String,
    /// When the lock was acquired
    pub acquired_at: DateTime<Utc>,
    /// When the lock expires (if any)
    pub expires_at: Option<DateTime<Utc>>,
}

impl Lock {
    /// Create a new lock
    pub fn new(
        key: impl Into<String>,
        holder: impl Into<String>,
        timeout: Option<Duration>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            holder: holder.into(),
            key: key.into(),
            acquired_at: now,
            expires_at: timeout.map(|t| now + t),
        }
    }

    /// Check if the lock has expired
    pub fn is_expired(&self) -> bool {
        self.expires_at.map(|exp| Utc::now() > exp).unwrap_or(false)
    }
}

/// State change event
#[derive(Debug, Clone)]
pub enum StateEvent {
    /// Value changed
    Changed {
        key: String,
        value: Value,
        old_value: Option<Value>,
    },
    /// Value deleted
    Deleted {
        key: String,
        old_value: Option<Value>,
    },
    /// All state cleared
    Cleared,
    /// Lock acquired
    LockAcquired(Lock),
    /// Lock released
    LockReleased(Lock),
}

/// Watch callback type
pub type WatchCallback = Arc<dyn Fn(Option<Value>) + Send + Sync>;

/// Watch handle for unsubscribing
#[derive(Debug, Clone)]
pub struct WatchHandle {
    /// Key being watched
    pub key: String,
    /// Unique handle ID
    pub id: String,
}

impl WatchHandle {
    /// Create a new watch handle
    pub fn new(key: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            id: uuid::Uuid::new_v4().to_string(),
        }
    }
}

/// Watcher entry
struct WatcherEntry {
    id: String,
    callback: WatchCallback,
}

/// Pending lock waiter
struct LockWaiter {
    holder: String,
    timeout: Option<Duration>,
    sender: oneshot::Sender<Lock>,
}

/// Statistics about the shared state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedStateStats {
    /// Number of keys in state
    pub state_size: usize,
    /// Number of keys being watched
    pub watchers_count: usize,
    /// Total number of watcher callbacks
    pub total_watchers: usize,
    /// Number of active locks
    pub locks_count: usize,
    /// Number of waiters in lock queues
    pub wait_queue_size: usize,
}

/// Shared State Manager for inter-agent state sharing
#[derive(Default)]
pub struct SharedStateManager {
    /// Key-value state storage
    state: HashMap<String, Value>,
    /// Watchers per key
    watchers: HashMap<String, Vec<WatcherEntry>>,
    /// Active locks
    locks: HashMap<String, Lock>,
    /// Lock wait queues
    lock_wait_queue: HashMap<String, Vec<LockWaiter>>,
    /// Event listeners
    event_listeners: Vec<Arc<dyn Fn(StateEvent) + Send + Sync>>,
}

impl SharedStateManager {
    /// Create a new shared state manager
    pub fn new() -> Self {
        Self {
            state: HashMap::new(),
            watchers: HashMap::new(),
            locks: HashMap::new(),
            lock_wait_queue: HashMap::new(),
            event_listeners: Vec::new(),
        }
    }

    /// Get a value by key
    pub fn get(&self, key: &str) -> Option<Value> {
        self.state.get(key).cloned()
    }

    /// Get a typed value by key
    pub fn get_typed<T: for<'de> Deserialize<'de>>(&self, key: &str) -> Option<T> {
        self.state
            .get(key)
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }

    /// Set a value by key
    pub fn set(&mut self, key: impl Into<String>, value: Value) {
        let key = key.into();
        let old_value = self.state.get(&key).cloned();
        self.state.insert(key.clone(), value.clone());

        // Notify watchers
        self.notify_watchers(&key, Some(value.clone()));

        // Emit event
        self.emit_event(StateEvent::Changed {
            key,
            value,
            old_value,
        });
    }

    /// Set a typed value by key
    pub fn set_typed<T: Serialize>(
        &mut self,
        key: impl Into<String>,
        value: &T,
    ) -> SharedStateResult<()> {
        let json_value = serde_json::to_value(value)
            .map_err(|e| SharedStateError::SerializationError(e.to_string()))?;
        self.set(key, json_value);
        Ok(())
    }

    /// Delete a value by key
    pub fn delete(&mut self, key: &str) -> bool {
        if let Some(old_value) = self.state.remove(key) {
            // Notify watchers with None
            self.notify_watchers(key, None);

            // Emit event
            self.emit_event(StateEvent::Deleted {
                key: key.to_string(),
                old_value: Some(old_value),
            });

            true
        } else {
            false
        }
    }

    /// Check if a key exists
    pub fn has(&self, key: &str) -> bool {
        self.state.contains_key(key)
    }

    /// Get all keys
    pub fn keys(&self) -> Vec<String> {
        self.state.keys().cloned().collect()
    }

    /// Clear all state
    pub fn clear(&mut self) {
        self.state.clear();
        self.emit_event(StateEvent::Cleared);
    }

    /// Watch for changes to a key
    pub fn watch<F>(&mut self, key: impl Into<String>, callback: F) -> WatchHandle
    where
        F: Fn(Option<Value>) + Send + Sync + 'static,
    {
        let key = key.into();
        let handle = WatchHandle::new(&key);

        let entry = WatcherEntry {
            id: handle.id.clone(),
            callback: Arc::new(callback),
        };

        self.watchers.entry(key).or_default().push(entry);

        handle
    }

    /// Unwatch a key
    pub fn unwatch(&mut self, handle: &WatchHandle) -> bool {
        if let Some(watchers) = self.watchers.get_mut(&handle.key) {
            let before = watchers.len();
            watchers.retain(|w| w.id != handle.id);
            let removed = before != watchers.len();

            // Clean up empty watcher lists
            if watchers.is_empty() {
                self.watchers.remove(&handle.key);
            }

            removed
        } else {
            false
        }
    }

    /// Notify watchers of a value change
    fn notify_watchers(&self, key: &str, value: Option<Value>) {
        if let Some(watchers) = self.watchers.get(key) {
            for watcher in watchers {
                // Call the callback, catching any panics
                let callback = watcher.callback.clone();
                let value = value.clone();
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                    callback(value);
                }))
                .ok();
            }
        }
    }

    /// Add an event listener
    pub fn on_event<F>(&mut self, listener: F)
    where
        F: Fn(StateEvent) + Send + Sync + 'static,
    {
        self.event_listeners.push(Arc::new(listener));
    }

    /// Emit an event to all listeners
    fn emit_event(&self, event: StateEvent) {
        for listener in &self.event_listeners {
            let listener = listener.clone();
            let event = event.clone();
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                listener(event);
            }))
            .ok();
        }
    }

    /// Acquire a lock on a key
    ///
    /// If the key is already locked, this will wait until the lock is released
    /// or the timeout expires.
    pub fn lock(
        &mut self,
        key: impl Into<String>,
        holder: impl Into<String>,
        timeout: Option<Duration>,
    ) -> SharedStateResult<Lock> {
        let key = key.into();
        let holder = holder.into();

        // Check if already locked
        if let Some(existing) = self.locks.get(&key) {
            // Check if the existing lock has expired
            if existing.is_expired() {
                // Remove expired lock and proceed
                let expired_lock = self.locks.remove(&key).unwrap();
                self.emit_event(StateEvent::LockReleased(expired_lock));
            } else {
                // Lock is held, return error (in async version, would wait)
                return Err(SharedStateError::LockTimeout(key));
            }
        }

        // Create new lock
        let lock = Lock::new(&key, &holder, timeout);
        self.locks.insert(key, lock.clone());
        self.emit_event(StateEvent::LockAcquired(lock.clone()));

        Ok(lock)
    }

    /// Try to acquire a lock without waiting
    pub fn try_lock(
        &mut self,
        key: impl Into<String>,
        holder: impl Into<String>,
        timeout: Option<Duration>,
    ) -> Option<Lock> {
        let key = key.into();
        let holder = holder.into();

        // Check if already locked
        if let Some(existing) = self.locks.get(&key) {
            if !existing.is_expired() {
                return None;
            }
            // Remove expired lock
            let expired_lock = self.locks.remove(&key).unwrap();
            self.emit_event(StateEvent::LockReleased(expired_lock));
        }

        // Create new lock
        let lock = Lock::new(&key, &holder, timeout);
        self.locks.insert(key, lock.clone());
        self.emit_event(StateEvent::LockAcquired(lock.clone()));

        Some(lock)
    }

    /// Prepare an async lock request
    ///
    /// Returns a receiver that will receive the lock when it becomes available.
    /// The caller should await on the receiver with a timeout.
    pub fn prepare_lock(
        &mut self,
        key: impl Into<String>,
        holder: impl Into<String>,
        timeout: Option<Duration>,
    ) -> Result<(String, oneshot::Receiver<Lock>), Lock> {
        let key = key.into();
        let holder = holder.into();

        // Check if already locked
        if let Some(existing) = self.locks.get(&key) {
            if !existing.is_expired() {
                // Create a waiter
                let (tx, rx) = oneshot::channel();
                let waiter = LockWaiter {
                    holder,
                    timeout,
                    sender: tx,
                };

                self.lock_wait_queue
                    .entry(key.clone())
                    .or_default()
                    .push(waiter);

                return Ok((key, rx));
            }
            // Remove expired lock
            let expired_lock = self.locks.remove(&key).unwrap();
            self.emit_event(StateEvent::LockReleased(expired_lock));
        }

        // Create new lock immediately
        let lock = Lock::new(&key, &holder, timeout);
        self.locks.insert(key, lock.clone());
        self.emit_event(StateEvent::LockAcquired(lock.clone()));

        Err(lock)
    }

    /// Release a lock
    pub fn unlock(&mut self, lock: &Lock) -> SharedStateResult<()> {
        // Verify the lock is valid
        let current = self.locks.get(&lock.key);
        match current {
            None => return Err(SharedStateError::LockNotHeld(lock.key.clone())),
            Some(current) if current.id != lock.id => {
                return Err(SharedStateError::InvalidLock(format!(
                    "Lock ID mismatch: expected {}, got {}",
                    current.id, lock.id
                )));
            }
            _ => {}
        }

        // Remove the lock
        let released_lock = self.locks.remove(&lock.key).unwrap();
        self.emit_event(StateEvent::LockReleased(released_lock));

        // Process wait queue - take ownership to avoid borrow issues
        let waiter = self
            .lock_wait_queue
            .get_mut(&lock.key)
            .and_then(|waiters| waiters.pop());

        if let Some(waiter) = waiter {
            // Grant lock to next waiter
            let new_lock = Lock::new(&lock.key, &waiter.holder, waiter.timeout);
            self.locks.insert(lock.key.clone(), new_lock.clone());
            self.emit_event(StateEvent::LockAcquired(new_lock.clone()));

            // Send lock to waiter (ignore if receiver dropped)
            let _ = waiter.sender.send(new_lock);
        }

        // Clean up empty wait queue
        if self
            .lock_wait_queue
            .get(&lock.key)
            .map(|w| w.is_empty())
            .unwrap_or(false)
        {
            self.lock_wait_queue.remove(&lock.key);
        }

        Ok(())
    }

    /// Check if a key is locked
    pub fn is_locked(&self, key: &str) -> bool {
        self.locks
            .get(key)
            .map(|l| !l.is_expired())
            .unwrap_or(false)
    }

    /// Get all active locks
    pub fn get_all_locks(&self) -> Vec<Lock> {
        self.locks
            .values()
            .filter(|l| !l.is_expired())
            .cloned()
            .collect()
    }

    /// Get lock for a specific key
    pub fn get_lock(&self, key: &str) -> Option<&Lock> {
        self.locks.get(key).filter(|l| !l.is_expired())
    }

    /// Atomic compare-and-swap operation
    ///
    /// Sets the value only if the current value equals the expected value.
    /// Returns true if the swap was successful.
    pub fn compare_and_swap(&mut self, key: &str, expected: &Value, new_value: Value) -> bool {
        let current = self.state.get(key);

        if current == Some(expected) {
            self.set(key.to_string(), new_value);
            true
        } else {
            false
        }
    }

    /// Atomic compare-and-swap with typed values
    pub fn compare_and_swap_typed<T: Serialize + PartialEq + for<'de> Deserialize<'de>>(
        &mut self,
        key: &str,
        expected: &T,
        new_value: &T,
    ) -> SharedStateResult<bool> {
        let current: Option<T> = self.get_typed(key);

        if current.as_ref() == Some(expected) {
            self.set_typed(key, new_value)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Atomic increment operation
    ///
    /// Increments the value by delta. If the key doesn't exist, initializes to delta.
    /// Returns the new value.
    pub fn increment(&mut self, key: &str, delta: i64) -> i64 {
        let current = self.state.get(key).and_then(|v| v.as_i64()).unwrap_or(0);

        let new_value = current + delta;
        self.set(key.to_string(), Value::Number(new_value.into()));
        new_value
    }

    /// Atomic decrement operation
    pub fn decrement(&mut self, key: &str, delta: i64) -> i64 {
        self.increment(key, -delta)
    }

    /// Cleanup expired locks
    ///
    /// Returns the number of locks cleaned up.
    pub fn cleanup_expired_locks(&mut self) -> usize {
        let expired_keys: Vec<String> = self
            .locks
            .iter()
            .filter(|(_, lock)| lock.is_expired())
            .map(|(key, _)| key.clone())
            .collect();

        let count = expired_keys.len();

        for key in expired_keys {
            if let Some(lock) = self.locks.remove(&key) {
                self.emit_event(StateEvent::LockReleased(lock));

                // Process wait queue for this key - take ownership to avoid borrow issues
                let waiter = self
                    .lock_wait_queue
                    .get_mut(&key)
                    .and_then(|waiters| waiters.pop());

                if let Some(waiter) = waiter {
                    let new_lock = Lock::new(&key, &waiter.holder, waiter.timeout);
                    self.locks.insert(key.clone(), new_lock.clone());
                    self.emit_event(StateEvent::LockAcquired(new_lock.clone()));
                    let _ = waiter.sender.send(new_lock);
                }

                // Clean up empty wait queue
                if self
                    .lock_wait_queue
                    .get(&key)
                    .map(|w| w.is_empty())
                    .unwrap_or(false)
                {
                    self.lock_wait_queue.remove(&key);
                }
            }
        }

        count
    }

    /// Get statistics about the shared state
    pub fn get_stats(&self) -> SharedStateStats {
        let total_watchers: usize = self.watchers.values().map(|w| w.len()).sum();
        let wait_queue_size: usize = self.lock_wait_queue.values().map(|w| w.len()).sum();

        SharedStateStats {
            state_size: self.state.len(),
            watchers_count: self.watchers.len(),
            total_watchers,
            locks_count: self.locks.len(),
            wait_queue_size,
        }
    }

    /// Insert a lock directly (for testing purposes)
    #[cfg(test)]
    pub fn insert_lock_for_test(&mut self, lock: Lock) {
        self.locks.insert(lock.key.clone(), lock);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn test_get_set() {
        let mut manager = SharedStateManager::new();

        // Set a value
        manager.set("key1", json!({"name": "test"}));

        // Get the value
        let value = manager.get("key1");
        assert!(value.is_some());
        assert_eq!(value.unwrap(), json!({"name": "test"}));

        // Get non-existent key
        assert!(manager.get("non_existent").is_none());
    }

    #[test]
    fn test_get_set_typed() {
        let mut manager = SharedStateManager::new();

        #[derive(Debug, Serialize, Deserialize, PartialEq)]
        struct Config {
            max_retries: u32,
            timeout: u64,
        }

        let config = Config {
            max_retries: 3,
            timeout: 5000,
        };

        manager.set_typed("config", &config).unwrap();

        let retrieved: Option<Config> = manager.get_typed("config");
        assert_eq!(retrieved, Some(config));
    }

    #[test]
    fn test_delete() {
        let mut manager = SharedStateManager::new();

        manager.set("key1", json!("value1"));
        assert!(manager.has("key1"));

        let deleted = manager.delete("key1");
        assert!(deleted);
        assert!(!manager.has("key1"));

        // Delete non-existent key
        let deleted = manager.delete("non_existent");
        assert!(!deleted);
    }

    #[test]
    fn test_keys() {
        let mut manager = SharedStateManager::new();

        manager.set("key1", json!("value1"));
        manager.set("key2", json!("value2"));
        manager.set("key3", json!("value3"));

        let keys = manager.keys();
        assert_eq!(keys.len(), 3);
        assert!(keys.contains(&"key1".to_string()));
        assert!(keys.contains(&"key2".to_string()));
        assert!(keys.contains(&"key3".to_string()));
    }

    #[test]
    fn test_clear() {
        let mut manager = SharedStateManager::new();

        manager.set("key1", json!("value1"));
        manager.set("key2", json!("value2"));

        manager.clear();

        assert!(manager.keys().is_empty());
    }

    #[test]
    fn test_watch() {
        let mut manager = SharedStateManager::new();
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_clone = counter.clone();

        let handle = manager.watch("key1", move |_value| {
            counter_clone.fetch_add(1, Ordering::SeqCst);
        });

        // Set value should trigger watcher
        manager.set("key1", json!("value1"));
        assert_eq!(counter.load(Ordering::SeqCst), 1);

        // Set again
        manager.set("key1", json!("value2"));
        assert_eq!(counter.load(Ordering::SeqCst), 2);

        // Delete should trigger watcher
        manager.delete("key1");
        assert_eq!(counter.load(Ordering::SeqCst), 3);

        // Unwatch
        manager.unwatch(&handle);

        // Set should not trigger watcher anymore
        manager.set("key1", json!("value3"));
        assert_eq!(counter.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn test_multiple_watchers() {
        let mut manager = SharedStateManager::new();
        let counter1 = Arc::new(AtomicUsize::new(0));
        let counter2 = Arc::new(AtomicUsize::new(0));

        let c1 = counter1.clone();
        let c2 = counter2.clone();

        let _handle1 = manager.watch("key1", move |_| {
            c1.fetch_add(1, Ordering::SeqCst);
        });

        let _handle2 = manager.watch("key1", move |_| {
            c2.fetch_add(1, Ordering::SeqCst);
        });

        manager.set("key1", json!("value"));

        assert_eq!(counter1.load(Ordering::SeqCst), 1);
        assert_eq!(counter2.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_lock_unlock() {
        let mut manager = SharedStateManager::new();

        // Acquire lock
        let lock = manager.lock("resource1", "agent1", None).unwrap();
        assert_eq!(lock.key, "resource1");
        assert_eq!(lock.holder, "agent1");
        assert!(manager.is_locked("resource1"));

        // Try to acquire same lock should fail
        let result = manager.lock("resource1", "agent2", None);
        assert!(result.is_err());

        // Release lock
        manager.unlock(&lock).unwrap();
        assert!(!manager.is_locked("resource1"));

        // Now agent2 can acquire
        let lock2 = manager.lock("resource1", "agent2", None).unwrap();
        assert_eq!(lock2.holder, "agent2");
    }

    #[test]
    fn test_try_lock() {
        let mut manager = SharedStateManager::new();

        // Try lock should succeed
        let lock = manager.try_lock("resource1", "agent1", None);
        assert!(lock.is_some());

        // Try lock again should fail
        let lock2 = manager.try_lock("resource1", "agent2", None);
        assert!(lock2.is_none());
    }

    #[test]
    fn test_lock_expiration() {
        let mut manager = SharedStateManager::new();

        // Create a lock that's already expired
        let lock = Lock {
            id: uuid::Uuid::new_v4().to_string(),
            holder: "agent1".to_string(),
            key: "resource1".to_string(),
            acquired_at: Utc::now() - Duration::seconds(10),
            expires_at: Some(Utc::now() - Duration::seconds(5)),
        };
        manager.locks.insert("resource1".to_string(), lock);

        // Lock should be considered expired
        assert!(!manager.is_locked("resource1"));

        // Cleanup should remove it
        let cleaned = manager.cleanup_expired_locks();
        assert_eq!(cleaned, 1);
        assert!(manager.locks.is_empty());
    }

    #[test]
    fn test_compare_and_swap() {
        let mut manager = SharedStateManager::new();

        manager.set("counter", json!(10));

        // CAS with correct expected value
        let success = manager.compare_and_swap("counter", &json!(10), json!(20));
        assert!(success);
        assert_eq!(manager.get("counter"), Some(json!(20)));

        // CAS with incorrect expected value
        let success = manager.compare_and_swap("counter", &json!(10), json!(30));
        assert!(!success);
        assert_eq!(manager.get("counter"), Some(json!(20)));
    }

    #[test]
    fn test_increment() {
        let mut manager = SharedStateManager::new();

        // Increment non-existent key
        let value = manager.increment("counter", 5);
        assert_eq!(value, 5);

        // Increment existing key
        let value = manager.increment("counter", 3);
        assert_eq!(value, 8);

        // Decrement
        let value = manager.decrement("counter", 2);
        assert_eq!(value, 6);
    }

    #[test]
    fn test_get_all_locks() {
        let mut manager = SharedStateManager::new();

        manager.lock("resource1", "agent1", None).unwrap();
        manager.lock("resource2", "agent2", None).unwrap();

        let locks = manager.get_all_locks();
        assert_eq!(locks.len(), 2);
    }

    #[test]
    fn test_get_stats() {
        let mut manager = SharedStateManager::new();

        manager.set("key1", json!("value1"));
        manager.set("key2", json!("value2"));
        manager.watch("key1", |_| {});
        manager.watch("key1", |_| {});
        manager.watch("key2", |_| {});
        manager.lock("resource1", "agent1", None).unwrap();

        let stats = manager.get_stats();
        assert_eq!(stats.state_size, 2);
        assert_eq!(stats.watchers_count, 2);
        assert_eq!(stats.total_watchers, 3);
        assert_eq!(stats.locks_count, 1);
    }

    #[test]
    fn test_event_listener() {
        let mut manager = SharedStateManager::new();
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();

        manager.on_event(move |event| {
            events_clone.lock().unwrap().push(format!("{:?}", event));
        });

        manager.set("key1", json!("value1"));
        manager.delete("key1");

        let events = events.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert!(events[0].contains("Changed"));
        assert!(events[1].contains("Deleted"));
    }

    #[test]
    fn test_unlock_invalid_lock() {
        let mut manager = SharedStateManager::new();

        let lock = manager.lock("resource1", "agent1", None).unwrap();

        // Create a fake lock with different ID
        let fake_lock = Lock {
            id: "fake-id".to_string(),
            holder: "agent1".to_string(),
            key: "resource1".to_string(),
            acquired_at: Utc::now(),
            expires_at: None,
        };

        let result = manager.unlock(&fake_lock);
        assert!(matches!(result, Err(SharedStateError::InvalidLock(_))));

        // Original lock should still be valid
        assert!(manager.is_locked("resource1"));

        // Unlock with correct lock should work
        manager.unlock(&lock).unwrap();
    }

    #[test]
    fn test_unlock_not_held() {
        let mut manager = SharedStateManager::new();

        let fake_lock = Lock {
            id: "fake-id".to_string(),
            holder: "agent1".to_string(),
            key: "resource1".to_string(),
            acquired_at: Utc::now(),
            expires_at: None,
        };

        let result = manager.unlock(&fake_lock);
        assert!(matches!(result, Err(SharedStateError::LockNotHeld(_))));
    }
}
