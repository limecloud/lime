//! Agent Pool
//!
//! Manages a pool of reusable agent workers with
//! acquire/release semantics and dynamic resizing.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use thiserror::Error;
use tokio::sync::oneshot;

/// Result type alias for pool operations
pub type PoolResult<T> = Result<T, PoolError>;

/// Error types for pool operations
#[derive(Debug, Error, Clone)]
pub enum PoolError {
    #[error("Pool is shutting down")]
    ShuttingDown,
    #[error("Acquire timeout")]
    AcquireTimeout,
    #[error("Worker not found: {0}")]
    WorkerNotFound(String),
    #[error("Invalid pool size: {0}")]
    InvalidPoolSize(String),
    #[error("Channel error: {0}")]
    ChannelError(String),
}

/// Agent worker representing a reusable agent instance
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorker {
    pub id: String,
    pub busy: bool,
    pub current_task: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used: DateTime<Utc>,
}

impl AgentWorker {
    pub fn new() -> Self {
        let now = Utc::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            busy: false,
            current_task: None,
            created_at: now,
            last_used: now,
        }
    }

    pub fn with_id(id: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: id.into(),
            busy: false,
            current_task: None,
            created_at: now,
            last_used: now,
        }
    }

    pub fn assign_task(&mut self, task_id: impl Into<String>) {
        self.busy = true;
        self.current_task = Some(task_id.into());
        self.last_used = Utc::now();
    }

    pub fn release(&mut self) {
        self.busy = false;
        self.current_task = None;
        self.last_used = Utc::now();
    }
}

impl Default for AgentWorker {
    fn default() -> Self {
        Self::new()
    }
}

/// Pool status information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolStatus {
    pub total_workers: usize,
    pub available_workers: usize,
    pub busy_workers: usize,
    pub waiting_requests: usize,
    pub shutting_down: bool,
    pub pool_size: usize,
}

struct AcquireWaiter {
    sender: oneshot::Sender<AgentWorker>,
}

/// Agent Pool for managing reusable agent workers
pub struct AgentPool {
    workers: Vec<AgentWorker>,
    available_indices: VecDeque<usize>,
    wait_queue: VecDeque<AcquireWaiter>,
    pool_size: usize,
    shutting_down: bool,
}

impl AgentPool {
    pub fn new(pool_size: usize) -> Self {
        let mut workers = Vec::with_capacity(pool_size);
        let mut available_indices = VecDeque::with_capacity(pool_size);
        for i in 0..pool_size {
            workers.push(AgentWorker::new());
            available_indices.push_back(i);
        }
        Self {
            workers,
            available_indices,
            wait_queue: VecDeque::new(),
            pool_size,
            shutting_down: false,
        }
    }

    pub fn pool_size(&self) -> usize {
        self.pool_size
    }

    pub fn available_count(&self) -> usize {
        self.available_indices.len()
    }

    pub fn busy_count(&self) -> usize {
        self.workers.len() - self.available_indices.len()
    }

    pub fn waiting_count(&self) -> usize {
        self.wait_queue.len()
    }

    pub fn is_shutting_down(&self) -> bool {
        self.shutting_down
    }

    pub fn acquire(&mut self) -> PoolResult<Option<AgentWorker>> {
        if self.shutting_down {
            return Err(PoolError::ShuttingDown);
        }
        if let Some(index) = self.available_indices.pop_front() {
            let worker = &mut self.workers[index];
            worker.busy = true;
            worker.last_used = Utc::now();
            return Ok(Some(worker.clone()));
        }
        Ok(None)
    }

    pub fn prepare_acquire(
        &mut self,
    ) -> PoolResult<Result<AgentWorker, oneshot::Receiver<AgentWorker>>> {
        if self.shutting_down {
            return Err(PoolError::ShuttingDown);
        }
        if let Some(index) = self.available_indices.pop_front() {
            let worker = &mut self.workers[index];
            worker.busy = true;
            worker.last_used = Utc::now();
            return Ok(Ok(worker.clone()));
        }
        let (tx, rx) = oneshot::channel();
        self.wait_queue.push_back(AcquireWaiter { sender: tx });
        Ok(Err(rx))
    }

    pub fn release(&mut self, worker: AgentWorker) -> PoolResult<()> {
        let index = self.workers.iter().position(|w| w.id == worker.id);
        match index {
            Some(idx) => {
                self.workers[idx].busy = false;
                self.workers[idx].current_task = None;
                self.workers[idx].last_used = Utc::now();
                while let Some(waiter) = self.wait_queue.pop_front() {
                    self.workers[idx].busy = true;
                    self.workers[idx].last_used = Utc::now();
                    if waiter.sender.send(self.workers[idx].clone()).is_ok() {
                        return Ok(());
                    }
                    self.workers[idx].busy = false;
                }
                self.available_indices.push_back(idx);
                Ok(())
            }
            None => Err(PoolError::WorkerNotFound(worker.id)),
        }
    }

    pub fn resize(&mut self, new_size: usize) -> PoolResult<()> {
        if new_size == 0 {
            return Err(PoolError::InvalidPoolSize(
                "Pool size must be at least 1".to_string(),
            ));
        }
        if new_size > self.pool_size {
            let to_add = new_size - self.pool_size;
            for _ in 0..to_add {
                let new_index = self.workers.len();
                self.workers.push(AgentWorker::new());
                self.available_indices.push_back(new_index);
            }
        } else if new_size < self.pool_size {
            let to_remove = self.pool_size - new_size;
            let mut removed = 0;
            let mut new_available = VecDeque::new();
            while let Some(idx) = self.available_indices.pop_back() {
                if removed < to_remove && idx >= new_size {
                    removed += 1;
                } else {
                    new_available.push_front(idx);
                }
            }
            self.available_indices = new_available;
            while self.workers.len() > new_size {
                let last_idx = self.workers.len() - 1;
                if !self.workers[last_idx].busy {
                    self.workers.pop();
                    self.available_indices.retain(|&i| i != last_idx);
                } else {
                    break;
                }
            }
        }
        self.pool_size = new_size;
        Ok(())
    }

    pub fn start_shutdown(&mut self) -> usize {
        self.shutting_down = true;
        self.wait_queue.clear();
        self.busy_count()
    }

    pub fn is_shutdown_complete(&self) -> bool {
        self.shutting_down && self.busy_count() == 0
    }

    pub fn get_status(&self) -> PoolStatus {
        PoolStatus {
            total_workers: self.workers.len(),
            available_workers: self.available_indices.len(),
            busy_workers: self.workers.len() - self.available_indices.len(),
            waiting_requests: self.wait_queue.len(),
            shutting_down: self.shutting_down,
            pool_size: self.pool_size,
        }
    }

    pub fn get_workers(&self) -> &[AgentWorker] {
        &self.workers
    }

    pub fn get_worker(&self, worker_id: &str) -> Option<&AgentWorker> {
        self.workers.iter().find(|w| w.id == worker_id)
    }
}

impl Default for AgentPool {
    fn default() -> Self {
        Self::new(4)
    }
}
