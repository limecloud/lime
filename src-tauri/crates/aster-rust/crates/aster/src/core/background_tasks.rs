//! 后台对话任务管理器
//!
//! 用于将对话转到后台运行

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

/// 后台对话任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundTask {
    /// 任务 ID
    pub id: String,
    /// 任务类型
    pub task_type: String,
    /// 用户输入
    pub user_input: String,
    /// 任务状态
    pub status: TaskStatus,
    /// 开始时间（毫秒）
    pub start_time: u64,
    /// 结束时间（毫秒）
    #[serde(default)]
    pub end_time: Option<u64>,
    /// 文本输出
    pub text_output: String,
    /// 工具调用记录
    pub tool_calls: Vec<ToolCallRecord>,
    /// 输出文件路径
    pub output_file: PathBuf,
    /// 是否已取消
    pub cancelled: bool,
    /// 错误信息
    #[serde(default)]
    pub error: Option<String>,
}

/// 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Running,
    Completed,
    Failed,
}

/// 工具调用记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRecord {
    /// 工具名称
    pub name: String,
    /// 输入参数
    pub input: serde_json::Value,
    /// 执行结果
    #[serde(default)]
    pub result: Option<String>,
    /// 错误信息
    #[serde(default)]
    pub error: Option<String>,
    /// 时间戳
    pub timestamp: u64,
}

/// 任务摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSummary {
    pub id: String,
    pub task_type: String,
    pub status: TaskStatus,
    pub user_input: String,
    pub duration: u64,
    pub output_preview: String,
}

/// 任务统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskStats {
    pub total: usize,
    pub running: usize,
    pub completed: usize,
    pub failed: usize,
}

/// 后台任务管理器
pub struct BackgroundTaskManager {
    tasks: RwLock<HashMap<String, BackgroundTask>>,
    tasks_dir: PathBuf,
}

impl BackgroundTaskManager {
    /// 创建新的任务管理器
    pub fn new() -> Self {
        let tasks_dir = get_tasks_dir();
        Self {
            tasks: RwLock::new(HashMap::new()),
            tasks_dir,
        }
    }

    /// 创建新的后台任务
    pub fn create_task(&self, user_input: &str) -> BackgroundTask {
        let task_id = Uuid::new_v4().to_string();
        let output_file = self.tasks_dir.join(format!("{}.log", task_id));
        let now = current_timestamp();

        let task = BackgroundTask {
            id: task_id.clone(),
            task_type: "conversation".to_string(),
            user_input: user_input.to_string(),
            status: TaskStatus::Running,
            start_time: now,
            end_time: None,
            text_output: String::new(),
            tool_calls: Vec::new(),
            output_file: output_file.clone(),
            cancelled: false,
            error: None,
        };

        // 写入任务开始信息
        if let Ok(mut file) = File::create(&output_file) {
            let _ = writeln!(file, "=== Background Task Started ===");
            let _ = writeln!(file, "Task ID: {}", task_id);
            let _ = writeln!(file, "User Input: {}", user_input);
            let _ = writeln!(file, "Start Time: {}", now);
            let _ = writeln!(file);
        }

        self.tasks.write().insert(task_id, task.clone());
        task
    }

    /// 追加文本输出
    pub fn append_text(&self, task_id: &str, text: &str) {
        let mut tasks = self.tasks.write();
        if let Some(task) = tasks.get_mut(task_id) {
            task.text_output.push_str(text);

            // 写入文件
            if let Ok(mut file) = OpenOptions::new().append(true).open(&task.output_file) {
                let _ = file.write_all(text.as_bytes());
            }
        }
    }

    /// 添加工具调用记录
    pub fn add_tool_call(
        &self,
        task_id: &str,
        tool_name: &str,
        input: serde_json::Value,
        result: Option<String>,
        error: Option<String>,
    ) {
        let mut tasks = self.tasks.write();
        if let Some(task) = tasks.get_mut(task_id) {
            let record = ToolCallRecord {
                name: tool_name.to_string(),
                input: input.clone(),
                result: result.clone(),
                error: error.clone(),
                timestamp: current_timestamp(),
            };
            task.tool_calls.push(record);

            // 写入文件
            if let Ok(mut file) = OpenOptions::new().append(true).open(&task.output_file) {
                let _ = writeln!(file, "\n--- Tool: {} ---", tool_name);
                let _ = writeln!(
                    file,
                    "Input: {}",
                    serde_json::to_string_pretty(&input).unwrap_or_default()
                );
                if let Some(ref r) = result {
                    let preview = if r.len() > 1000 {
                        r.get(..1000).unwrap_or(r)
                    } else {
                        r
                    };
                    let _ = writeln!(file, "Result: {}", preview);
                }
                if let Some(ref e) = error {
                    let _ = writeln!(file, "Error: {}", e);
                }
                let _ = writeln!(file);
            }
        }
    }

    /// 完成任务
    pub fn complete_task(&self, task_id: &str, success: bool, error: Option<String>) {
        let mut tasks = self.tasks.write();
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = if success {
                TaskStatus::Completed
            } else {
                TaskStatus::Failed
            };
            task.end_time = Some(current_timestamp());
            task.error = error.clone();

            // 写入结束信息
            if let Ok(mut file) = OpenOptions::new().append(true).open(&task.output_file) {
                let status = if success { "Completed" } else { "Failed" };
                let _ = writeln!(file, "\n=== Task {} ===", status);
                let _ = writeln!(file, "End Time: {}", task.end_time.unwrap());
                let _ = writeln!(
                    file,
                    "Duration: {}ms",
                    task.end_time.unwrap() - task.start_time
                );
                if let Some(ref e) = error {
                    let _ = writeln!(file, "Error: {}", e);
                }
            }
        }
    }

    /// 取消任务
    pub fn cancel_task(&self, task_id: &str) -> bool {
        let mut tasks = self.tasks.write();
        if let Some(task) = tasks.get_mut(task_id) {
            task.cancelled = true;
            drop(tasks);
            self.complete_task(task_id, false, Some("Task cancelled by user".to_string()));
            return true;
        }
        false
    }

    /// 获取任务
    pub fn get_task(&self, task_id: &str) -> Option<BackgroundTask> {
        self.tasks.read().get(task_id).cloned()
    }

    /// 获取所有任务
    pub fn get_all_tasks(&self) -> Vec<BackgroundTask> {
        self.tasks.read().values().cloned().collect()
    }

    /// 获取任务摘要列表
    pub fn get_task_summaries(&self) -> Vec<TaskSummary> {
        let now = current_timestamp();
        self.tasks
            .read()
            .values()
            .map(|task| {
                let input_preview = if task.user_input.len() > 100 {
                    format!(
                        "{}...",
                        task.user_input.get(..100).unwrap_or(&task.user_input)
                    )
                } else {
                    task.user_input.clone()
                };
                let output_preview = if task.text_output.len() > 200 {
                    format!(
                        "{}...",
                        task.text_output.get(..200).unwrap_or(&task.text_output)
                    )
                } else {
                    task.text_output.clone()
                };

                TaskSummary {
                    id: task.id.clone(),
                    task_type: task.task_type.clone(),
                    status: task.status,
                    user_input: input_preview,
                    duration: task.end_time.unwrap_or(now) - task.start_time,
                    output_preview,
                }
            })
            .collect()
    }

    /// 删除任务
    pub fn delete_task(&self, task_id: &str) -> bool {
        let mut tasks = self.tasks.write();
        if let Some(task) = tasks.remove(task_id) {
            // 如果任务还在运行，先取消
            if task.status == TaskStatus::Running {
                drop(tasks);
                self.cancel_task(task_id);
            }

            // 删除输出文件
            let _ = fs::remove_file(&task.output_file);
            return true;
        }
        false
    }

    /// 清理已完成的任务
    pub fn cleanup_completed(&self) -> usize {
        let task_ids: Vec<String> = self
            .tasks
            .read()
            .iter()
            .filter(|(_, t)| t.status != TaskStatus::Running)
            .map(|(id, _)| id.clone())
            .collect();

        let mut cleaned = 0;
        for id in task_ids {
            if self.delete_task(&id) {
                cleaned += 1;
            }
        }
        cleaned
    }

    /// 获取任务统计
    pub fn get_stats(&self) -> TaskStats {
        let tasks = self.tasks.read();
        TaskStats {
            total: tasks.len(),
            running: tasks
                .values()
                .filter(|t| t.status == TaskStatus::Running)
                .count(),
            completed: tasks
                .values()
                .filter(|t| t.status == TaskStatus::Completed)
                .count(),
            failed: tasks
                .values()
                .filter(|t| t.status == TaskStatus::Failed)
                .count(),
        }
    }

    /// 检查任务是否已取消
    pub fn is_cancelled(&self, task_id: &str) -> bool {
        self.tasks
            .read()
            .get(task_id)
            .map(|t| t.cancelled)
            .unwrap_or(false)
    }
}

impl Default for BackgroundTaskManager {
    fn default() -> Self {
        Self::new()
    }
}

// 辅助函数

/// 获取任务目录
fn get_tasks_dir() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
        .join("tasks")
        .join("conversations");

    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }

    dir
}

/// 获取当前时间戳（毫秒）
fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 全局任务管理器
static GLOBAL_MANAGER: once_cell::sync::Lazy<Arc<BackgroundTaskManager>> =
    once_cell::sync::Lazy::new(|| Arc::new(BackgroundTaskManager::new()));

/// 获取全局任务管理器
pub fn global_task_manager() -> Arc<BackgroundTaskManager> {
    GLOBAL_MANAGER.clone()
}
