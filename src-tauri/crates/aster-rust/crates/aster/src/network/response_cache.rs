//! 响应缓存（非流式）
//!
//! 用于缓存短时间内的完全相同请求响应，降低上游成本与时延。
//! 典型使用方式：
//! - 请求进入时：按规范化请求生成 key，先查缓存
//! - 响应返回时：对可缓存状态码（默认仅 200）且体积可接受的响应写入缓存

use indexmap::IndexMap;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseCacheConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_ttl_secs")]
    pub ttl_secs: u64,
    #[serde(default = "default_max_entries")]
    pub max_entries: usize,
    #[serde(default = "default_max_body_bytes")]
    pub max_body_bytes: usize,
    #[serde(default = "default_cacheable_status_codes")]
    pub cacheable_status_codes: Vec<u16>,
}

fn default_enabled() -> bool {
    true
}
fn default_ttl_secs() -> u64 {
    600
}
fn default_max_entries() -> usize {
    200
}
fn default_max_body_bytes() -> usize {
    1_048_576
}
fn default_cacheable_status_codes() -> Vec<u16> {
    vec![200]
}

impl Default for ResponseCacheConfig {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            ttl_secs: default_ttl_secs(),
            max_entries: default_max_entries(),
            max_body_bytes: default_max_body_bytes(),
            cacheable_status_codes: default_cacheable_status_codes(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedHttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResponseCacheStats {
    pub size: usize,
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    response: CachedHttpResponse,
    cached_at: Instant,
}

#[derive(Debug, Default, Clone)]
struct CacheCounters {
    hits: u64,
    misses: u64,
    evictions: u64,
}

pub struct ResponseCacheStore {
    config: ResponseCacheConfig,
    entries: Mutex<IndexMap<String, CacheEntry>>,
    counters: Mutex<CacheCounters>,
}

impl ResponseCacheStore {
    pub fn new(config: ResponseCacheConfig) -> Self {
        Self {
            config,
            entries: Mutex::new(IndexMap::new()),
            counters: Mutex::new(CacheCounters::default()),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }

    pub fn config(&self) -> ResponseCacheConfig {
        self.config.clone()
    }

    pub fn should_cache_status(&self, status: u16) -> bool {
        self.config.cacheable_status_codes.contains(&status)
    }

    pub fn get(&self, key: &str) -> Option<CachedHttpResponse> {
        if !self.config.enabled {
            return None;
        }

        self.cleanup();

        let mut entries = self.entries.lock();
        let entry = entries.shift_remove(key);
        match entry {
            None => {
                self.counters.lock().misses += 1;
                None
            }
            Some(entry) => {
                let ttl = Duration::from_secs(self.config.ttl_secs);
                if entry.cached_at.elapsed() > ttl {
                    self.counters.lock().misses += 1;
                    None
                } else {
                    let response = entry.response.clone();
                    entries.insert(key.to_string(), entry);
                    self.counters.lock().hits += 1;
                    Some(response)
                }
            }
        }
    }

    pub fn set(&self, key: &str, response: CachedHttpResponse) -> bool {
        if !self.config.enabled {
            return false;
        }

        if !self.should_cache_status(response.status) {
            return false;
        }

        if response.body.len() > self.config.max_body_bytes {
            return false;
        }

        self.cleanup();

        let mut entries = self.entries.lock();
        entries.shift_remove(key);
        entries.insert(
            key.to_string(),
            CacheEntry {
                response,
                cached_at: Instant::now(),
            },
        );

        while entries.len() > self.config.max_entries {
            if entries.shift_remove_index(0).is_some() {
                self.counters.lock().evictions += 1;
            }
        }

        true
    }

    pub fn clear(&self) {
        self.entries.lock().clear();
    }

    pub fn cleanup(&self) {
        let ttl = Duration::from_secs(self.config.ttl_secs);
        self.entries
            .lock()
            .retain(|_, entry| entry.cached_at.elapsed() <= ttl);
    }

    pub fn stats(&self) -> ResponseCacheStats {
        let size = self.entries.lock().len();
        let counters = self.counters.lock().clone();
        ResponseCacheStats {
            size,
            hits: counters.hits,
            misses: counters.misses,
            evictions: counters.evictions,
        }
    }

    pub fn hit_rate_percent(&self) -> f64 {
        let stats = self.stats();
        let total = stats.hits + stats.misses;
        if total == 0 {
            0.0
        } else {
            (stats.hits as f64 / total as f64) * 100.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_response(body: &str) -> CachedHttpResponse {
        CachedHttpResponse {
            status: 200,
            headers: HashMap::from([("content-type".to_string(), "application/json".to_string())]),
            body: body.to_string(),
        }
    }

    #[test]
    fn should_cache_success_response() {
        let store = ResponseCacheStore::new(ResponseCacheConfig::default());
        assert!(store.set("k1", make_response(r#"{"ok":true}"#)));
        let got = store.get("k1").expect("cache hit expected");
        assert_eq!(got.status, 200);
        assert_eq!(got.body, r#"{"ok":true}"#);
    }

    #[test]
    fn should_not_cache_error_response() {
        let store = ResponseCacheStore::new(ResponseCacheConfig::default());
        let inserted = store.set(
            "k2",
            CachedHttpResponse {
                status: 500,
                headers: HashMap::new(),
                body: "boom".to_string(),
            },
        );
        assert!(!inserted);
        assert!(store.get("k2").is_none());
    }

    #[test]
    fn should_only_cache_200_by_default() {
        let store = ResponseCacheStore::new(ResponseCacheConfig::default());
        let inserted = store.set(
            "k200",
            CachedHttpResponse {
                status: 201,
                headers: HashMap::new(),
                body: "created".to_string(),
            },
        );
        assert!(!inserted);
        assert!(store.get("k200").is_none());
    }

    #[test]
    fn should_support_custom_cacheable_status_codes() {
        let store = ResponseCacheStore::new(ResponseCacheConfig {
            enabled: true,
            ttl_secs: 600,
            max_entries: 10,
            max_body_bytes: 1024,
            cacheable_status_codes: vec![200, 201, 204],
        });
        let inserted = store.set(
            "k201",
            CachedHttpResponse {
                status: 201,
                headers: HashMap::new(),
                body: "created".to_string(),
            },
        );
        assert!(inserted);
        assert!(store.get("k201").is_some());
    }

    #[test]
    fn should_evict_oldest_when_capacity_exceeded() {
        let store = ResponseCacheStore::new(ResponseCacheConfig {
            enabled: true,
            ttl_secs: 600,
            max_entries: 2,
            max_body_bytes: 1024,
            cacheable_status_codes: vec![200],
        });
        assert!(store.set("k1", make_response("1")));
        assert!(store.set("k2", make_response("2")));
        assert!(store.set("k3", make_response("3")));

        assert!(store.get("k1").is_none());
        assert!(store.get("k2").is_some());
        assert!(store.get("k3").is_some());
        assert!(store.stats().evictions >= 1);
    }

    #[test]
    fn should_expire_entries_by_ttl() {
        let store = ResponseCacheStore::new(ResponseCacheConfig {
            enabled: true,
            ttl_secs: 1,
            max_entries: 10,
            max_body_bytes: 1024,
            cacheable_status_codes: vec![200],
        });
        assert!(store.set("k4", make_response("x")));
        std::thread::sleep(Duration::from_millis(1100));
        assert!(store.get("k4").is_none());
    }
}
