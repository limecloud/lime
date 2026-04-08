//! 超时处理模块
//!
//! 提供任务超时管理、进程终止策略和超时配置
//!
//! # 功能
//! - 超时时间管理
//! - 优雅终止策略
//! - 超时延长和重置

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};

use super::types::TimeoutStats;

/// 超时回调函数类型
pub(crate) type TimeoutCallback = Arc<dyn Fn(&str) + Send + Sync>;

/// 超时配置
#[derive(Debug, Clone)]
pub struct TimeoutConfig {
    pub default_timeout_ms: u64,
    pub max_timeout_ms: u64,
    pub graceful_shutdown_timeout_ms: u64,
}

impl Default for TimeoutConfig {
    fn default() -> Self {
        Self {
            default_timeout_ms: 120_000,         // 2 分钟
            max_timeout_ms: 600_000,             // 10 分钟
            graceful_shutdown_timeout_ms: 5_000, // 5 秒
        }
    }
}

/// 超时句柄
#[derive(Debug, Clone)]
pub struct TimeoutHandle {
    pub id: String,
    pub start_time: i64,
    pub duration_ms: u64,
    pub cancelled: bool,
}

/// 超时管理器
pub struct TimeoutManager {
    timeouts: Arc<RwLock<HashMap<String, TimeoutHandle>>>,
    config: TimeoutConfig,
    on_timeout: Option<TimeoutCallback>,
}

impl TimeoutManager {
    /// 创建新的超时管理器
    pub fn new(config: TimeoutConfig) -> Self {
        Self {
            timeouts: Arc::new(RwLock::new(HashMap::new())),
            config,
            on_timeout: None,
        }
    }

    /// 设置超时回调
    pub fn set_on_timeout<F>(&mut self, callback: F)
    where
        F: Fn(&str) + Send + Sync + 'static,
    {
        self.on_timeout = Some(Arc::new(callback));
    }

    /// 设置超时
    pub async fn set_timeout<F>(
        &self,
        id: &str,
        callback: F,
        duration_ms: Option<u64>,
    ) -> TimeoutHandle
    where
        F: FnOnce() + Send + 'static,
    {
        // 清除已存在的超时
        self.clear_timeout(id).await;

        let actual_duration = duration_ms
            .unwrap_or(self.config.default_timeout_ms)
            .min(self.config.max_timeout_ms);

        let handle = TimeoutHandle {
            id: id.to_string(),
            start_time: chrono::Utc::now().timestamp_millis(),
            duration_ms: actual_duration,
            cancelled: false,
        };

        self.timeouts
            .write()
            .await
            .insert(id.to_string(), handle.clone());

        // 启动超时任务
        let timeouts = Arc::clone(&self.timeouts);
        let id_clone = id.to_string();
        let on_timeout = self.on_timeout.clone();

        tokio::spawn(async move {
            sleep(Duration::from_millis(actual_duration)).await;

            let mut guard = timeouts.write().await;
            if let Some(h) = guard.get(&id_clone) {
                if !h.cancelled {
                    if let Some(cb) = on_timeout {
                        cb(&id_clone);
                    }
                    callback();
                    guard.remove(&id_clone);
                }
            }
        });

        handle
    }

    /// 清除超时
    pub async fn clear_timeout(&self, id: &str) -> bool {
        let mut timeouts = self.timeouts.write().await;
        if let Some(handle) = timeouts.get_mut(id) {
            handle.cancelled = true;
            timeouts.remove(id);
            true
        } else {
            false
        }
    }

    /// 获取剩余时间
    pub async fn get_remaining_time(&self, id: &str) -> Option<u64> {
        let timeouts = self.timeouts.read().await;
        if let Some(handle) = timeouts.get(id) {
            let elapsed = (chrono::Utc::now().timestamp_millis() - handle.start_time) as u64;
            Some(handle.duration_ms.saturating_sub(elapsed))
        } else {
            None
        }
    }

    /// 检查是否已超时
    pub async fn is_timed_out(&self, id: &str) -> bool {
        !self.timeouts.read().await.contains_key(id)
    }

    /// 重置超时
    pub async fn reset_timeout(&self, id: &str) -> bool {
        let mut timeouts = self.timeouts.write().await;
        if let Some(handle) = timeouts.get_mut(id) {
            handle.start_time = chrono::Utc::now().timestamp_millis();
            true
        } else {
            false
        }
    }

    /// 延长超时时间
    pub async fn extend_timeout(&self, id: &str, additional_ms: u64) -> bool {
        let mut timeouts = self.timeouts.write().await;
        if let Some(handle) = timeouts.get_mut(id) {
            let new_duration = (handle.duration_ms + additional_ms).min(self.config.max_timeout_ms);
            handle.duration_ms = new_duration;
            true
        } else {
            false
        }
    }

    /// 获取所有超时信息
    pub async fn get_all_timeouts(&self) -> Vec<TimeoutHandle> {
        self.timeouts.read().await.values().cloned().collect()
    }

    /// 清除所有超时
    pub async fn clear_all(&self) -> usize {
        let mut timeouts = self.timeouts.write().await;
        let count = timeouts.len();
        for handle in timeouts.values_mut() {
            handle.cancelled = true;
        }
        timeouts.clear();
        count
    }

    /// 获取统计信息
    pub async fn get_stats(&self) -> TimeoutStats {
        TimeoutStats {
            total: self.timeouts.read().await.len(),
            default_timeout_ms: self.config.default_timeout_ms,
            max_timeout_ms: self.config.max_timeout_ms,
            graceful_shutdown_timeout_ms: self.config.graceful_shutdown_timeout_ms,
        }
    }
}

/// 带超时的 Promise
pub async fn promise_with_timeout<T, F>(
    future: F,
    timeout_ms: u64,
    timeout_error: Option<&str>,
) -> Result<T, String>
where
    F: std::future::Future<Output = T>,
{
    match tokio::time::timeout(Duration::from_millis(timeout_ms), future).await {
        Ok(result) => Ok(result),
        Err(_) => Err(timeout_error.unwrap_or("Operation timed out").to_string()),
    }
}

/// 可取消的延迟
pub struct CancellableDelay {
    duration_ms: u64,
    cancelled: Arc<RwLock<bool>>,
}

impl CancellableDelay {
    /// 创建新的可取消延迟
    pub fn new(duration_ms: u64) -> Self {
        Self {
            duration_ms,
            cancelled: Arc::new(RwLock::new(false)),
        }
    }

    /// 开始延迟
    pub async fn start(&self) -> Result<(), ()> {
        let cancelled = Arc::clone(&self.cancelled);
        let duration = Duration::from_millis(self.duration_ms);

        tokio::select! {
            _ = sleep(duration) => {
                if *cancelled.read().await {
                    Err(())
                } else {
                    Ok(())
                }
            }
        }
    }

    /// 取消延迟
    pub async fn cancel(&self) {
        *self.cancelled.write().await = true;
    }
}
