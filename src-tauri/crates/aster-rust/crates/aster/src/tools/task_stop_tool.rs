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

const TASK_STOP_TOOL_ALIASES: &[&str] = &["TaskStopTool", "KillShell"];

/// TaskStop 工具输入参数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskStopInput {
    /// 要终止的后台任务 ID
    #[serde(alias = "shell_id")]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskStopPayload {
    message: String,
    task_id: String,
    task_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
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

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| ToolError::execution_failed(format!("序列化 TaskStop 结果失败: {error}")))
}

#[async_trait]
impl Tool for TaskStopTool {
    fn name(&self) -> &str {
        "TaskStop"
    }

    fn aliases(&self) -> &'static [&'static str] {
        TASK_STOP_TOOL_ALIASES
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
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: TaskStopInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("TaskStop 参数无效: {error}")))?;
        let task_id = input
            .task_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: task_id"))?;

        let Some(existing_state) = self.task_manager.get_status(task_id).await else {
            return Ok(
                ToolResult::error(format!("No task found with ID: {}", task_id))
                    .with_metadata("task_id", serde_json::json!(task_id)),
            );
        };

        if !existing_state.status.is_running() {
            return Ok(ToolResult::error(format!(
                "Task {} is not running (status: {})",
                task_id, existing_state.status
            ))
            .with_metadata("task_id", serde_json::json!(task_id))
            .with_metadata("task_type", serde_json::json!("local_bash"))
            .with_metadata(
                "status",
                serde_json::json!(existing_state.status.to_string()),
            )
            .with_metadata("command", serde_json::json!(existing_state.command)));
        }

        let command = existing_state.command.clone();
        match self.task_manager.kill(task_id).await {
            Ok(()) => {
                let output = TaskStopPayload {
                    message: format!("Successfully stopped task: {} ({})", task_id, command),
                    task_id: task_id.to_string(),
                    task_type: "local_bash".to_string(),
                    command: Some(command.clone()),
                };
                Ok(ToolResult::success(pretty_json(&output)?)
                    .with_metadata("task_id", serde_json::json!(task_id))
                    .with_metadata("task_type", serde_json::json!("local_bash"))
                    .with_metadata("command", serde_json::json!(command)))
            }
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
        assert_eq!(schema["additionalProperties"], serde_json::json!(false));
        assert!(schema["required"].is_null());
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
        let output = result.output.as_ref().unwrap();
        assert!(output.contains("\"task_type\": \"local_bash\""));
        assert!(output.contains("\"message\": \"Successfully stopped task:"));
        assert_eq!(
            result.metadata["task_type"],
            serde_json::json!("local_bash")
        );
    }

    #[tokio::test]
    async fn test_execute_accepts_shell_id_alias() {
        let temp_dir = TempDir::new().unwrap();
        let task_manager =
            Arc::new(TaskManager::new().with_output_directory(temp_dir.path().to_path_buf()));
        let tool = TaskStopTool::with_task_manager(task_manager.clone());
        let context = create_test_context();

        let task_id = task_manager
            .start("sleep 5", &context)
            .await
            .expect("task should start");

        let result = tool
            .execute(serde_json::json!({ "shell_id": task_id }), &context)
            .await
            .expect("execute should succeed");

        assert!(result.success);
        assert_eq!(
            result.metadata["task_type"],
            serde_json::json!("local_bash")
        );
    }

    #[tokio::test]
    async fn test_execute_rejects_completed_task() {
        let temp_dir = TempDir::new().unwrap();
        let task_manager =
            Arc::new(TaskManager::new().with_output_directory(temp_dir.path().to_path_buf()));
        let tool = TaskStopTool::with_task_manager(task_manager.clone());
        let context = create_test_context();

        let task_id = task_manager
            .start("echo done", &context)
            .await
            .expect("task should start");
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        let result = tool
            .execute(serde_json::json!({ "task_id": task_id }), &context)
            .await
            .expect("execute should return a structured error result");

        assert!(!result.success);
        let expected_error = format!("Task {} is not running (status: completed)", task_id);
        assert_eq!(result.error.as_deref(), Some(expected_error.as_str()));
        assert_eq!(
            result.metadata["task_type"],
            serde_json::json!("local_bash")
        );
        assert_eq!(result.metadata["status"], serde_json::json!("completed"));
    }
}
