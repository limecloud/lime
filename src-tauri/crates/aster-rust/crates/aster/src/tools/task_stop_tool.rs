//! TaskStop 工具实现
//!
//! 提供新版后台任务终止能力：
//! - 标准工具名为 `TaskStop`
//! - 主参数为 `task_id`
//! - 兼容接受旧的 `shell_id` 参数名

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolOptions, ToolResult};
use super::error::ToolError;
use super::task::TaskManager;

/// TaskStop 工具输入参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStopInput {
    /// 要终止的后台任务 ID
    #[serde(alias = "shell_id")]
    pub task_id: String,
}

/// 停止后台任务的新版工具
#[derive(Debug)]
pub struct TaskStopTool {
    task_manager: Arc<TaskManager>,
}

impl Default for TaskStopTool {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskStopTool {
    pub fn new() -> Self {
        Self {
            task_manager: Arc::new(TaskManager::new()),
        }
    }

    pub fn with_task_manager(task_manager: Arc<TaskManager>) -> Self {
        Self { task_manager }
    }
}

#[async_trait]
impl Tool for TaskStopTool {
    fn name(&self) -> &str {
        "TaskStop"
    }

    fn description(&self) -> &str {
        "停止正在运行的后台任务。优先使用 task_id；shell_id 仅作为旧参数名兼容。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "要停止的后台任务 ID"
                },
                "shell_id": {
                    "type": "string",
                    "description": "旧参数名兼容别名，请改用 task_id"
                }
            },
            "required": ["task_id"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let task_id = params
            .get("task_id")
            .or_else(|| params.get("shell_id"))
            .and_then(|value| value.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: task_id"))?;

        let existing_state = self.task_manager.get_status(task_id).await;
        let existing_command = existing_state.as_ref().map(|state| state.command.clone());

        match self.task_manager.kill(task_id).await {
            Ok(()) => {
                let command = existing_command.unwrap_or_else(|| "unknown".to_string());
                Ok(ToolResult::success(format!(
                    "Successfully stopped task: {} ({})",
                    task_id, command
                ))
                .with_metadata("task_id", serde_json::json!(task_id))
                .with_metadata("task_type", serde_json::json!("background_task"))
                .with_metadata("command", serde_json::json!(command)))
            }
            Err(ToolError::NotFound(_)) => Ok(ToolResult::error(format!(
                "No task found with ID: {}",
                task_id
            ))
            .with_metadata("task_id", serde_json::json!(task_id))),
            Err(error) => Ok(ToolResult::error(format!(
                "Failed to stop task {}: {}",
                task_id, error
            ))
            .with_metadata("task_id", serde_json::json!(task_id))),
        }
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        let task_id = params
            .get("task_id")
            .or_else(|| params.get("shell_id"))
            .and_then(|value| value.as_str());

        match task_id {
            Some(value) if !value.trim().is_empty() => PermissionCheckResult::allow(),
            _ => PermissionCheckResult::deny("task_id cannot be empty"),
        }
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(0)
            .with_base_timeout(std::time::Duration::from_secs(10))
            .with_dynamic_timeout(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn create_test_context() -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("test-session")
            .with_user("test-user")
    }

    fn create_test_manager() -> Arc<TaskManager> {
        let temp_dir = TempDir::new().unwrap();
        Arc::new(TaskManager::new().with_output_directory(temp_dir.path().to_path_buf()))
    }

    #[test]
    fn test_tool_name() {
        let tool = TaskStopTool::new();
        assert_eq!(tool.name(), "TaskStop");
    }

    #[test]
    fn test_tool_input_schema() {
        let tool = TaskStopTool::new();
        let schema = tool.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["task_id"].is_object());
        assert!(schema["properties"]["shell_id"].is_object());
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("task_id")));
    }

    #[test]
    fn test_tool_options() {
        let tool = TaskStopTool::new();
        let options = tool.options();
        assert_eq!(options.max_retries, 0);
        assert_eq!(options.base_timeout, std::time::Duration::from_secs(10));
        assert!(!options.enable_dynamic_timeout);
    }

    #[tokio::test]
    async fn test_check_permissions_accepts_task_id() {
        let tool = TaskStopTool::new();
        let context = create_test_context();

        let result = tool
            .check_permissions(&serde_json::json!({"task_id": "task-1"}), &context)
            .await;
        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_check_permissions_accepts_shell_id_alias() {
        let tool = TaskStopTool::new();
        let context = create_test_context();

        let result = tool
            .check_permissions(&serde_json::json!({"shell_id": "task-1"}), &context)
            .await;
        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_check_permissions_rejects_empty_id() {
        let tool = TaskStopTool::new();
        let context = create_test_context();

        let result = tool
            .check_permissions(&serde_json::json!({"task_id": ""}), &context)
            .await;
        assert!(result.is_denied());
    }

    #[tokio::test]
    async fn test_execute_stops_running_task() {
        let task_manager = create_test_manager();
        let tool = TaskStopTool::with_task_manager(task_manager.clone());
        let context = create_test_context();

        let task_id = task_manager
            .start("sleep 5", &context)
            .await
            .expect("task should start");

        let result = tool
            .execute(serde_json::json!({ "task_id": task_id }), &context)
            .await
            .expect("execute should succeed");

        assert!(result.success);
        assert_eq!(
            result.metadata["task_type"],
            serde_json::json!("background_task")
        );
    }
}
