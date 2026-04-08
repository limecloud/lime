//! 后台任务持久化模块
//!
//! 负责保存和恢复后台任务状态
//!
//! # 功能
//! - 任务状态持久化
//! - Agent 状态持久化
//! - 自动过期清理
//! - 导入/导出功能

use std::collections::HashMap;
use std::path::PathBuf;
use tokio::fs;

use super::types::{
    AgentStats, PersistedAgentState, PersistedTaskState, PersistenceStats, TaskStats, TaskType,
};

/// 持久化配置
#[derive(Debug, Clone)]
pub struct PersistenceOptions {
    pub storage_dir: PathBuf,
    pub auto_restore: bool,
    pub expiry_time_ms: u64,
    pub compress: bool,
}

impl Default for PersistenceOptions {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            storage_dir: home.join(".aster").join("background-tasks"),
            auto_restore: true,
            expiry_time_ms: 86_400_000, // 24 小时
            compress: false,
        }
    }
}

/// 持久化管理器
pub struct PersistenceManager {
    storage_dir: PathBuf,
    options: PersistenceOptions,
}

impl PersistenceManager {
    /// 创建新的持久化管理器
    pub async fn new(options: PersistenceOptions) -> Result<Self, String> {
        let storage_dir = options.storage_dir.clone();

        // 确保存储目录存在
        if !storage_dir.exists() {
            fs::create_dir_all(&storage_dir)
                .await
                .map_err(|e| format!("Failed to create storage directory: {}", e))?;
        }

        Ok(Self {
            storage_dir,
            options,
        })
    }

    /// 获取任务文件路径
    fn get_task_file_path(&self, id: &str, task_type: TaskType) -> PathBuf {
        let prefix = match task_type {
            TaskType::Bash => "bash",
            TaskType::Agent => "agent",
            TaskType::Generic => "generic",
        };
        self.storage_dir.join(format!("{}_{}.json", prefix, id))
    }

    /// 保存任务状态
    pub async fn save_task(&self, task: &PersistedTaskState) -> Result<(), String> {
        let file_path = self.get_task_file_path(&task.id, task.task_type);
        let data = serde_json::to_string_pretty(task)
            .map_err(|e| format!("Failed to serialize task: {}", e))?;

        fs::write(&file_path, data)
            .await
            .map_err(|e| format!("Failed to write task file: {}", e))?;

        Ok(())
    }

    /// 加载任务状态
    pub async fn load_task(&self, id: &str, task_type: TaskType) -> Option<PersistedTaskState> {
        let file_path = self.get_task_file_path(id, task_type);

        if !file_path.exists() {
            return None;
        }

        let data = fs::read_to_string(&file_path).await.ok()?;
        let task: PersistedTaskState = serde_json::from_str(&data).ok()?;

        // 检查是否过期
        if self.is_expired(&task) {
            let _ = self.delete_task(id, task_type).await;
            return None;
        }

        Some(task)
    }

    /// 删除任务状态
    pub async fn delete_task(&self, id: &str, task_type: TaskType) -> Result<(), String> {
        let file_path = self.get_task_file_path(id, task_type);

        if file_path.exists() {
            fs::remove_file(&file_path)
                .await
                .map_err(|e| format!("Failed to delete task file: {}", e))?;
        }

        Ok(())
    }

    /// 检查任务是否过期
    fn is_expired(&self, task: &PersistedTaskState) -> bool {
        let now = chrono::Utc::now().timestamp_millis();
        let age = (now - task.start_time) as u64;
        age > self.options.expiry_time_ms
    }

    /// 保存 Agent 状态
    pub async fn save_agent(&self, agent: &PersistedAgentState) -> Result<(), String> {
        let agent_dir = self
            .storage_dir
            .parent()
            .unwrap_or(&self.storage_dir)
            .join("agents");

        if !agent_dir.exists() {
            fs::create_dir_all(&agent_dir)
                .await
                .map_err(|e| format!("Failed to create agent directory: {}", e))?;
        }

        let file_path = agent_dir.join(format!("{}.json", agent.id));
        let data = serde_json::to_string_pretty(agent)
            .map_err(|e| format!("Failed to serialize agent: {}", e))?;

        fs::write(&file_path, data)
            .await
            .map_err(|e| format!("Failed to write agent file: {}", e))?;

        Ok(())
    }

    /// 加载 Agent 状态
    pub async fn load_agent(&self, id: &str) -> Option<PersistedAgentState> {
        let agent_dir = self
            .storage_dir
            .parent()
            .unwrap_or(&self.storage_dir)
            .join("agents");
        let file_path = agent_dir.join(format!("{}.json", id));

        if !file_path.exists() {
            return None;
        }

        let data = fs::read_to_string(&file_path).await.ok()?;
        serde_json::from_str(&data).ok()
    }

    /// 列出所有保存的任务
    pub async fn list_tasks(&self, task_type: Option<TaskType>) -> Vec<PersistedTaskState> {
        let mut tasks = Vec::new();

        let mut entries = match fs::read_dir(&self.storage_dir).await {
            Ok(e) => e,
            Err(_) => return tasks,
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }

            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            let file_type = if file_name.starts_with("bash_") {
                Some(TaskType::Bash)
            } else if file_name.starts_with("agent_") {
                Some(TaskType::Agent)
            } else if file_name.starts_with("generic_") {
                Some(TaskType::Generic)
            } else {
                None
            };

            if let Some(ft) = file_type {
                if task_type.is_none() || task_type == Some(ft) {
                    if let Ok(data) = fs::read_to_string(&path).await {
                        if let Ok(task) = serde_json::from_str::<PersistedTaskState>(&data) {
                            tasks.push(task);
                        }
                    }
                }
            }
        }

        tasks
    }

    /// 列出所有保存的 Agent
    pub async fn list_agents(&self) -> Vec<PersistedAgentState> {
        let mut agents = Vec::new();
        let agent_dir = self
            .storage_dir
            .parent()
            .unwrap_or(&self.storage_dir)
            .join("agents");

        if !agent_dir.exists() {
            return agents;
        }

        let mut entries = match fs::read_dir(&agent_dir).await {
            Ok(e) => e,
            Err(_) => return agents,
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                if let Ok(data) = fs::read_to_string(&path).await {
                    if let Ok(agent) = serde_json::from_str::<PersistedAgentState>(&data) {
                        agents.push(agent);
                    }
                }
            }
        }

        agents
    }

    /// 清理过期的任务
    pub async fn cleanup_expired(&self) -> usize {
        let tasks = self.list_tasks(None).await;
        let mut cleaned = 0;

        for task in tasks {
            if self.is_expired(&task) && self.delete_task(&task.id, task.task_type).await.is_ok() {
                cleaned += 1;
            }
        }

        cleaned
    }

    /// 清理已完成的任务
    pub async fn cleanup_completed(&self) -> usize {
        let tasks = self.list_tasks(None).await;
        let mut cleaned = 0;

        for task in tasks {
            if (task.status == "completed" || task.status == "failed")
                && self.delete_task(&task.id, task.task_type).await.is_ok()
            {
                cleaned += 1;
            }
        }

        cleaned
    }

    /// 清除所有任务
    pub async fn clear_all(&self) -> usize {
        let mut cleared = 0;

        let mut entries = match fs::read_dir(&self.storage_dir).await {
            Ok(e) => e,
            Err(_) => return cleared,
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") && fs::remove_file(&path).await.is_ok()
            {
                cleared += 1;
            }
        }

        cleared
    }

    /// 获取统计信息
    pub async fn get_stats(&self) -> PersistenceStats {
        let tasks = self.list_tasks(None).await;
        let agents = self.list_agents().await;

        let mut tasks_by_status: HashMap<String, usize> = HashMap::new();
        for task in &tasks {
            *tasks_by_status.entry(task.status.clone()).or_insert(0) += 1;
        }

        let mut agents_by_status: HashMap<String, usize> = HashMap::new();
        for agent in &agents {
            *agents_by_status.entry(agent.status.clone()).or_insert(0) += 1;
        }

        PersistenceStats {
            tasks: TaskStats {
                total: tasks.len(),
                by_status: tasks_by_status,
            },
            agents: AgentStats {
                total: agents.len(),
                by_status: agents_by_status,
            },
            storage_dir: self.storage_dir.to_string_lossy().to_string(),
            expiry_time_ms: self.options.expiry_time_ms,
        }
    }
}
