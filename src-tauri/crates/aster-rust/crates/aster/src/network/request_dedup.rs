//! 请求去重与短时回放
//!
//! 用于防止并发重复请求导致上游被多次调用：
//! - 首个请求登记为 InProgress
//! - 同指纹请求等待首个请求完成
//! - 完成后在短 TTL 内回放响应

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::Notify;

static TIMESTAMP_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\[\w{3}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\w+\]\s*")
        .expect("timestamp regex should be valid")
});

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestDedupConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_ttl_secs")]
    pub ttl_secs: u64,
    #[serde(default = "default_wait_timeout_ms")]
    pub wait_timeout_ms: u64,
}

fn default_enabled() -> bool {
    true
}
fn default_ttl_secs() -> u64 {
    30
}
fn default_wait_timeout_ms() -> u64 {
    15_000
}

impl Default for RequestDedupConfig {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            ttl_secs: default_ttl_secs(),
            wait_timeout_ms: default_wait_timeout_ms(),
        }
    }
}

#[derive(Debug, Clone)]
pub enum RequestDedupCheck {
    New,
    InProgress { notify: Arc<Notify> },
    Completed { status: u16, body: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompletedReplay {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RequestDedupStats {
    pub inflight_size: u64,
    pub completed_size: u64,
    pub check_new_total: u64,
    pub check_in_progress_total: u64,
    pub check_completed_total: u64,
    pub wait_success_total: u64,
    pub wait_timeout_total: u64,
    pub wait_no_result_total: u64,
    pub complete_total: u64,
    pub remove_total: u64,
}

#[derive(Debug, Clone)]
struct InflightEntry {
    started_at: Instant,
    notify: Arc<Notify>,
}

#[derive(Debug, Clone)]
struct CompletedEntry {
    status: u16,
    body: String,
    completed_at: Instant,
}

pub struct RequestDedupStore {
    config: RequestDedupConfig,
    inflight: Mutex<HashMap<String, InflightEntry>>,
    completed: Mutex<HashMap<String, CompletedEntry>>,
    check_new_total: AtomicU64,
    check_in_progress_total: AtomicU64,
    check_completed_total: AtomicU64,
    wait_success_total: AtomicU64,
    wait_timeout_total: AtomicU64,
    wait_no_result_total: AtomicU64,
    complete_total: AtomicU64,
    remove_total: AtomicU64,
}

impl RequestDedupStore {
    pub fn new(config: RequestDedupConfig) -> Self {
        Self {
            config,
            inflight: Mutex::new(HashMap::new()),
            completed: Mutex::new(HashMap::new()),
            check_new_total: AtomicU64::new(0),
            check_in_progress_total: AtomicU64::new(0),
            check_completed_total: AtomicU64::new(0),
            wait_success_total: AtomicU64::new(0),
            wait_timeout_total: AtomicU64::new(0),
            wait_no_result_total: AtomicU64::new(0),
            complete_total: AtomicU64::new(0),
            remove_total: AtomicU64::new(0),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }

    pub fn config(&self) -> RequestDedupConfig {
        self.config.clone()
    }

    pub fn check_or_register(&self, key: &str) -> RequestDedupCheck {
        if !self.config.enabled {
            return RequestDedupCheck::New;
        }

        self.cleanup();

        if let Some(entry) = self.completed.lock().get(key).cloned() {
            self.check_completed_total.fetch_add(1, Ordering::Relaxed);
            return RequestDedupCheck::Completed {
                status: entry.status,
                body: entry.body,
            };
        }

        {
            let inflight = self.inflight.lock();
            if let Some(entry) = inflight.get(key) {
                self.check_in_progress_total.fetch_add(1, Ordering::Relaxed);
                return RequestDedupCheck::InProgress {
                    notify: entry.notify.clone(),
                };
            }
        }

        let notify = Arc::new(Notify::new());
        self.inflight.lock().insert(
            key.to_string(),
            InflightEntry {
                started_at: Instant::now(),
                notify,
            },
        );
        self.check_new_total.fetch_add(1, Ordering::Relaxed);
        RequestDedupCheck::New
    }

    pub async fn wait_for_completion(
        &self,
        key: &str,
        notify: Arc<Notify>,
    ) -> Option<CompletedReplay> {
        if !self.config.enabled {
            return None;
        }

        if let Some(entry) = self.completed.lock().get(key).cloned() {
            self.wait_success_total.fetch_add(1, Ordering::Relaxed);
            return Some(CompletedReplay {
                status: entry.status,
                body: entry.body,
            });
        }

        let timeout = Duration::from_millis(self.config.wait_timeout_ms);
        if tokio::time::timeout(timeout, notify.notified())
            .await
            .is_err()
        {
            self.wait_timeout_total.fetch_add(1, Ordering::Relaxed);
            return None;
        }

        let replay = self
            .completed
            .lock()
            .get(key)
            .cloned()
            .map(|entry| CompletedReplay {
                status: entry.status,
                body: entry.body,
            });
        if replay.is_some() {
            self.wait_success_total.fetch_add(1, Ordering::Relaxed);
        } else {
            self.wait_no_result_total.fetch_add(1, Ordering::Relaxed);
        }
        replay
    }

    pub fn complete(&self, key: &str, status: u16, body: String) {
        if !self.config.enabled {
            return;
        }

        let inflight = self.inflight.lock().remove(key);
        self.completed.lock().insert(
            key.to_string(),
            CompletedEntry {
                status,
                body,
                completed_at: Instant::now(),
            },
        );

        if let Some(entry) = inflight {
            entry.notify.notify_waiters();
        }
        self.complete_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn remove(&self, key: &str) {
        let inflight = self.inflight.lock().remove(key);
        let removed_inflight = inflight.is_some();
        let removed_completed = self.completed.lock().remove(key);
        if let Some(entry) = inflight {
            entry.notify.notify_waiters();
        }
        if removed_inflight || removed_completed.is_some() {
            self.remove_total.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn cleanup(&self) {
        let ttl = Duration::from_secs(self.config.ttl_secs);
        let inflight_ttl =
            Duration::from_millis(self.config.wait_timeout_ms.saturating_mul(3).max(30_000));
        let now = Instant::now();

        self.completed
            .lock()
            .retain(|_, entry| now.duration_since(entry.completed_at) < ttl);
        self.inflight
            .lock()
            .retain(|_, entry| now.duration_since(entry.started_at) < inflight_ttl);
    }

    pub fn stats(&self) -> RequestDedupStats {
        let inflight_size = self.inflight.lock().len() as u64;
        let completed_size = self.completed.lock().len() as u64;
        RequestDedupStats {
            inflight_size,
            completed_size,
            check_new_total: self.check_new_total.load(Ordering::Relaxed),
            check_in_progress_total: self.check_in_progress_total.load(Ordering::Relaxed),
            check_completed_total: self.check_completed_total.load(Ordering::Relaxed),
            wait_success_total: self.wait_success_total.load(Ordering::Relaxed),
            wait_timeout_total: self.wait_timeout_total.load(Ordering::Relaxed),
            wait_no_result_total: self.wait_no_result_total.load(Ordering::Relaxed),
            complete_total: self.complete_total.load(Ordering::Relaxed),
            remove_total: self.remove_total.load(Ordering::Relaxed),
        }
    }

    pub fn replay_rate_percent(&self) -> f64 {
        let stats = self.stats();
        let total_checks =
            stats.check_new_total + stats.check_in_progress_total + stats.check_completed_total;
        if total_checks == 0 {
            0.0
        } else {
            let replay = stats.check_completed_total + stats.wait_success_total;
            (replay as f64 / total_checks as f64) * 100.0
        }
    }
}

pub fn build_request_fingerprint(value: &Value) -> String {
    let normalized = normalize_request_value(value);
    let content = serde_json::to_string(&normalized).unwrap_or_else(|_| value.to_string());
    let digest = Sha256::digest(content.as_bytes());
    let hex = format!("{digest:x}");
    hex.chars().take(32).collect()
}

fn normalize_request_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => normalize_object(map),
        Value::Array(arr) => Value::Array(arr.iter().map(normalize_request_value).collect()),
        Value::String(text) => Value::String(strip_timestamp_prefix(text)),
        _ => value.clone(),
    }
}

fn normalize_object(map: &Map<String, Value>) -> Value {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();

    let mut result = Map::new();
    for key in keys {
        if should_skip_key(key) {
            continue;
        }
        if let Some(val) = map.get(key) {
            result.insert(key.clone(), normalize_request_value(val));
        }
    }
    Value::Object(result)
}

fn should_skip_key(key: &str) -> bool {
    matches!(
        key,
        "stream"
            | "user"
            | "request_id"
            | "x-request-id"
            | "requestId"
            | "timestamp"
            | "idempotency_key"
            | "idempotency-key"
    )
}

fn strip_timestamp_prefix(text: &str) -> String {
    TIMESTAMP_PATTERN.replace(text, "").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled_store() -> RequestDedupStore {
        RequestDedupStore::new(RequestDedupConfig {
            enabled: true,
            ttl_secs: 30,
            wait_timeout_ms: 1_000,
        })
    }

    #[test]
    fn fingerprint_should_ignore_key_order_and_stream() {
        let req_a = serde_json::json!({
            "model":"gpt-4o",
            "stream": false,
            "messages":[{"role":"user","content":"hello"}],
            "temperature": 0.2
        });
        let req_b = serde_json::json!({
            "temperature": 0.2,
            "messages":[{"content":"hello","role":"user"}],
            "model":"gpt-4o"
        });

        let f1 = build_request_fingerprint(&req_a);
        let f2 = build_request_fingerprint(&req_b);
        assert_eq!(f1, f2);
    }

    #[test]
    fn fingerprint_should_strip_timestamp_prefix() {
        let req_a = serde_json::json!({
            "messages":[{"role":"user","content":"[MON 2026-03-02 10:10 UTC] hello"}]
        });
        let req_b = serde_json::json!({
            "messages":[{"role":"user","content":"hello"}]
        });

        assert_eq!(
            build_request_fingerprint(&req_a),
            build_request_fingerprint(&req_b)
        );
    }

    #[tokio::test]
    async fn should_wait_and_receive_completed_response() {
        let store = enabled_store();
        let key = "k-1";

        assert!(matches!(
            store.check_or_register(key),
            RequestDedupCheck::New
        ));
        let notify = match store.check_or_register(key) {
            RequestDedupCheck::InProgress { notify } => notify,
            other => panic!("expected in progress, got {other:?}"),
        };

        let waiter = store.wait_for_completion(key, notify);
        store.complete(key, 200, r#"{"ok":true}"#.to_string());
        let replay = waiter.await.expect("waiter should get replay");

        assert_eq!(replay.status, 200);
        assert_eq!(replay.body, r#"{"ok":true}"#);
    }

    #[test]
    fn remove_should_clear_inflight_and_allow_new() {
        let store = enabled_store();
        let key = "k-2";

        assert!(matches!(
            store.check_or_register(key),
            RequestDedupCheck::New
        ));
        store.remove(key);
        assert!(matches!(
            store.check_or_register(key),
            RequestDedupCheck::New
        ));
    }

    #[tokio::test]
    async fn stats_should_track_check_wait_and_complete() {
        let store = enabled_store();
        let key = "k-stats";

        assert!(matches!(
            store.check_or_register(key),
            RequestDedupCheck::New
        ));
        let notify = match store.check_or_register(key) {
            RequestDedupCheck::InProgress { notify } => notify,
            other => panic!("expected in progress, got {other:?}"),
        };

        let wait = store.wait_for_completion(key, notify);
        store.complete(key, 200, "ok".to_string());
        let replay = wait.await;
        assert!(replay.is_some());

        assert!(matches!(
            store.check_or_register(key),
            RequestDedupCheck::Completed { .. }
        ));

        let stats = store.stats();
        assert_eq!(stats.check_new_total, 1);
        assert_eq!(stats.check_in_progress_total, 1);
        assert_eq!(stats.check_completed_total, 1);
        assert_eq!(stats.wait_success_total, 1);
        assert_eq!(stats.wait_timeout_total, 0);
        assert_eq!(stats.complete_total, 1);
    }
}
