//! 简单任务队列实现
//!
//! 支持优先级、并发控制和状态管理
//!
//! # 功能
//! - FIFO 队列
//! - 优先级支持 (high/normal/low)
//! - 并发控制
//! - 状态管理

use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use super::types::{QueueStatus, TaskPriority, TaskStatus, TaskType};

/// 任务执行函数类型
pub type TaskExecutor = Box<
    dyn FnOnce() -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send>>
        + Send
        + Sync,
>;

/// 队列中的任务
pub struct QueuedTask {
    pub id: String,
    pub task_type: TaskType,
    pub priority: TaskPriority,
    pub execute: Option<TaskExecutor>,
    pub enqueue_time: DateTime<Utc>,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
    pub status: TaskStatus,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// 任务队列配置
#[derive(Debug, Clone)]
pub struct TaskQueueOptions {
    pub max_concurrent: usize,
}

impl Default for TaskQueueOptions {
    fn default() -> Self {
        Self { max_concurrent: 10 }
    }
}

/// 任务队列回调
pub type TaskCallback = Arc<dyn Fn(&QueuedTask) + Send + Sync>;

/// 简单任务队列
pub struct SimpleTaskQueue {
    queue: Arc<Mutex<Vec<QueuedTask>>>,
    running: Arc<RwLock<HashMap<String, QueuedTask>>>,
    completed: Arc<RwLock<HashMap<String, QueuedTask>>>,
    failed: Arc<RwLock<HashMap<String, QueuedTask>>>,
    max_concurrent: usize,
    on_task_start: Option<TaskCallback>,
    on_task_complete: Option<TaskCallback>,
    on_task_failed: Option<TaskCallback>,
}

impl SimpleTaskQueue {
    /// 创建新的任务队列
    pub fn new(options: TaskQueueOptions) -> Self {
        Self {
            queue: Arc::new(Mutex::new(Vec::new())),
            running: Arc::new(RwLock::new(HashMap::new())),
            completed: Arc::new(RwLock::new(HashMap::new())),
            failed: Arc::new(RwLock::new(HashMap::new())),
            max_concurrent: options.max_concurrent,
            on_task_start: None,
            on_task_complete: None,
            on_task_failed: None,
        }
    }

    /// 设置任务开始回调
    pub fn set_on_task_start(&mut self, callback: TaskCallback) {
        self.on_task_start = Some(callback);
    }

    /// 设置任务完成回调
    pub fn set_on_task_complete(&mut self, callback: TaskCallback) {
        self.on_task_complete = Some(callback);
    }

    /// 设置任务失败回调
    pub fn set_on_task_failed(&mut self, callback: TaskCallback) {
        self.on_task_failed = Some(callback);
    }

    /// 添加任务到队列
    pub async fn enqueue(&self, mut task: QueuedTask) -> String {
        task.status = TaskStatus::Pending;
        task.enqueue_time = Utc::now();
        let task_id = task.id.clone();

        let mut queue = self.queue.lock().await;

        // 按优先级插入
        let insert_index = queue
            .iter()
            .position(|t| t.priority.order() > task.priority.order())
            .unwrap_or(queue.len());

        queue.insert(insert_index, task);
        drop(queue);

        // 尝试处理下一个任务
        self.process_next().await;

        task_id
    }

    /// 处理队列中的下一个任务
    async fn process_next(&self) {
        let running_count = self.running.read().await.len();
        if running_count >= self.max_concurrent {
            return;
        }

        let mut queue = self.queue.lock().await;
        if queue.is_empty() {
            return;
        }

        let mut task = queue.remove(0);
        drop(queue);

        // 更新任务状态
        task.status = TaskStatus::Running;
        task.start_time = Some(Utc::now());
        let task_id = task.id.clone();

        // 触发回调
        if let Some(ref callback) = self.on_task_start {
            callback(&task);
        }

        // 取出执行器
        let executor = task.execute.take();
        self.running.write().await.insert(task_id.clone(), task);

        // 执行任务
        if let Some(exec) = executor {
            let running = Arc::clone(&self.running);
            let completed = Arc::clone(&self.completed);
            let failed = Arc::clone(&self.failed);
            let on_complete = self.on_task_complete.clone();
            let on_failed = self.on_task_failed.clone();

            tokio::spawn(async move {
                let result = exec().await;

                if let Some(mut task) = running.write().await.remove(&task_id) {
                    task.end_time = Some(Utc::now());

                    match result {
                        Ok(value) => {
                            task.result = Some(value);
                            task.status = TaskStatus::Completed;
                            if let Some(cb) = on_complete {
                                cb(&task);
                            }
                            completed.write().await.insert(task_id, task);
                        }
                        Err(e) => {
                            task.error = Some(e);
                            task.status = TaskStatus::Failed;
                            if let Some(cb) = on_failed {
                                cb(&task);
                            }
                            failed.write().await.insert(task_id, task);
                        }
                    }
                }
            });
        }
    }

    /// 获取任务状态
    pub async fn get_task(&self, task_id: &str) -> Option<TaskStatus> {
        // 在队列中查找
        if self.queue.lock().await.iter().any(|t| t.id == task_id) {
            return Some(TaskStatus::Pending);
        }
        // 在运行中查找
        if self.running.read().await.contains_key(task_id) {
            return Some(TaskStatus::Running);
        }
        // 在已完成中查找
        if self.completed.read().await.contains_key(task_id) {
            return Some(TaskStatus::Completed);
        }
        // 在失败中查找
        if self.failed.read().await.contains_key(task_id) {
            return Some(TaskStatus::Failed);
        }
        None
    }

    /// 获取队列状态统计
    pub async fn get_status(&self) -> QueueStatus {
        let queued = self.queue.lock().await.len();
        let running = self.running.read().await.len();
        let completed = self.completed.read().await.len();
        let failed = self.failed.read().await.len();

        QueueStatus {
            queued,
            running,
            completed,
            failed,
            capacity: self.max_concurrent,
            available: self.max_concurrent.saturating_sub(running),
        }
    }

    /// 取消队列中的任务
    pub async fn cancel(&self, task_id: &str) -> bool {
        let mut queue = self.queue.lock().await;
        if let Some(pos) = queue.iter().position(|t| t.id == task_id) {
            let mut task = queue.remove(pos);
            task.status = TaskStatus::Cancelled;
            return true;
        }
        false
    }

    /// 清空队列
    pub async fn clear(&self) -> usize {
        let mut queue = self.queue.lock().await;
        let count = queue.len();
        queue.clear();
        count
    }

    /// 清理已完成的任务
    pub async fn cleanup_completed(&self) -> usize {
        let mut completed = self.completed.write().await;
        let count = completed.len();
        completed.clear();
        count
    }

    /// 清理失败的任务
    pub async fn cleanup_failed(&self) -> usize {
        let mut failed = self.failed.write().await;
        let count = failed.len();
        failed.clear();
        count
    }

    /// 获取按优先级分组的队列任务数
    pub async fn get_queued_by_priority(&self) -> HashMap<TaskPriority, usize> {
        let queue = self.queue.lock().await;
        let mut counts = HashMap::new();
        counts.insert(TaskPriority::High, 0);
        counts.insert(TaskPriority::Normal, 0);
        counts.insert(TaskPriority::Low, 0);

        for task in queue.iter() {
            *counts.entry(task.priority).or_insert(0) += 1;
        }
        counts
    }
}
