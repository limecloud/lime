//! 后台任务模块共享类型定义
//!
//! 包含任务优先级、状态、Shell 状态等核心类型

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 任务优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TaskPriority {
    High,
    #[default]
    Normal,
    Low,
}

impl TaskPriority {
    /// 获取优先级排序值（越小越优先）
    pub fn order(&self) -> u8 {
        match self {
            TaskPriority::High => 0,
            TaskPriority::Normal => 1,
            TaskPriority::Low => 2,
        }
    }
}

/// 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    #[default]
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// 任务类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TaskType {
    Bash,
    Agent,
    #[default]
    Generic,
}

/// Shell 状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ShellStatus {
    #[default]
    Running,
    Completed,
    Failed,
    Paused,
    Terminated,
}

/// 队列状态统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStatus {
    pub queued: usize,
    pub running: usize,
    pub completed: usize,
    pub failed: usize,
    pub capacity: usize,
    pub available: usize,
}

/// Shell 统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellStats {
    pub total: usize,
    pub running: usize,
    pub completed: usize,
    pub failed: usize,
    pub paused: usize,
    pub terminated: usize,
    pub max_shells: usize,
    pub available: usize,
}

/// 超时统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeoutStats {
    pub total: usize,
    pub default_timeout_ms: u64,
    pub max_timeout_ms: u64,
    pub graceful_shutdown_timeout_ms: u64,
}

/// 持久化统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceStats {
    pub tasks: TaskStats,
    pub agents: AgentStats,
    pub storage_dir: String,
    pub expiry_time_ms: u64,
}

/// 任务统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStats {
    pub total: usize,
    pub by_status: HashMap<String, usize>,
}

/// Agent 统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStats {
    pub total: usize,
    pub by_status: HashMap<String, usize>,
}

/// 后台任务管理器统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundStats {
    pub shells: ShellStats,
    pub queue: QueueStatus,
    pub timeouts: TimeoutStats,
    pub persistence: PersistenceStats,
}

/// 持久化的任务状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedTaskState {
    pub id: String,
    #[serde(rename = "type")]
    pub task_type: TaskType,
    pub command: Option<String>,
    pub status: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub exit_code: Option<i32>,
    pub output_size: usize,
    pub cwd: String,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// 持久化的 Agent 状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedAgentState {
    pub id: String,
    pub agent_type: String,
    pub status: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub current_step: Option<usize>,
    pub total_steps: Option<usize>,
    pub working_directory: String,
    pub history: Vec<AgentHistoryEntry>,
    pub intermediate_results: Vec<serde_json::Value>,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// Agent 历史记录条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHistoryEntry {
    pub timestamp: i64,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

/// Shell 输出事件
#[derive(Debug, Clone)]
pub struct ShellOutputEvent {
    pub id: String,
    pub data: String,
    pub output_type: ShellOutputType,
}

/// Shell 输出类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellOutputType {
    Stdout,
    Stderr,
}
