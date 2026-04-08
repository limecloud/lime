//! TaskOutput Tool - 任务输出查询工具
//!
//! 用于查询后台任务的状态和输出，对齐当前工具面

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolResult};
use super::error::ToolError;
use super::task::TaskManager;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

/// TaskOutputTool 输入参数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskOutputInput {
    /// 任务 ID
    pub task_id: String,
    /// 是否阻塞等待任务完成
    pub block: Option<bool>,
    /// 等待超时时间（毫秒）
    pub timeout: Option<u64>,
}

/// TaskOutputTool - 查询任务输出和状态
///
/// 对齐当前工具面的 TaskOutput 能力
pub struct TaskOutputTool {
    /// 任务管理器
    task_manager: Arc<TaskManager>,
}

impl TaskOutputTool {
    /// 创建新的 TaskOutputTool
    pub fn new() -> Self {
        Self {
            task_manager: Arc::new(TaskManager::new()),
        }
    }

    /// 使用自定义 TaskManager 创建 TaskOutputTool
    pub fn with_manager(task_manager: Arc<TaskManager>) -> Self {
        Self { task_manager }
    }
}

impl Default for TaskOutputTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for TaskOutputTool {
    fn name(&self) -> &str {
        "TaskOutput"
    }

    fn description(&self) -> &str {
        r#"获取后台任务的输出和状态

优先推荐直接使用 read 工具读取任务输出文件。`bash` 的后台执行结果会返回 `output_file`，
TaskOutput 用于按 `task_id` 查询后台执行状态与日志。

参数：
- task_id: 任务 ID（必需）
- block: 是否等待任务完成（默认 true）
- timeout: 等待超时时间（毫秒，默认 30000）"#
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "要查询的任务 ID"
                },
                "block": {
                    "type": "boolean",
                    "description": "是否等待任务完成（默认 true）"
                },
                "timeout": {
                    "type": "number",
                    "description": "等待超时时间（毫秒，默认 30000）"
                }
            },
            "required": ["task_id"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: TaskOutputInput = serde_json::from_value(params)
            .map_err(|e| ToolError::invalid_params(format!("参数解析失败: {}", e)))?;

        let block = input.block.unwrap_or(true);
        let timeout_ms = input.timeout.unwrap_or(30000);

        // 检查任务是否存在
        if !self.task_manager.task_exists(&input.task_id).await {
            return Err(ToolError::not_found(format!(
                "任务未找到: {}",
                input.task_id
            )));
        }

        // 如果需要阻塞等待
        if block {
            let timeout = Duration::from_millis(timeout_ms);
            let start_time = std::time::Instant::now();

            loop {
                if let Some(state) = self.task_manager.get_status(&input.task_id).await {
                    if state.status.is_terminal() {
                        break;
                    }
                }

                // 检查超时
                if start_time.elapsed() > timeout {
                    break;
                }

                // 等待100ms后重新检查
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }

        // 获取任务状态
        let state = self
            .task_manager
            .get_status(&input.task_id)
            .await
            .ok_or_else(|| ToolError::not_found(format!("任务状态未找到: {}", input.task_id)))?;
        let retrieval_status = if block && !state.status.is_terminal() {
            "timeout"
        } else if !block && state.status.is_running() {
            "not_ready"
        } else {
            "success"
        };
        let output_file = state.output_file.display().to_string();

        // 构建输出信息
        let mut output = Vec::new();
        output.push(
            "兼容提示: 新链路优先使用 read 工具读取任务输出文件，TaskOutput 仅作为旧 task_id 查询兜底。"
                .to_string(),
        );
        output.push(format!("=== 任务 {} ===", input.task_id));
        output.push(format!("命令: {}", state.command));
        output.push(format!("状态: {}", state.status));
        output.push(format!("开始时间: {}", format_instant(state.start_time)));

        let duration = state.duration();
        if let Some(end_time) = state.end_time {
            output.push(format!("结束时间: {}", format_instant(end_time)));
            output.push(format!("执行时间: {:.2}秒", duration.as_secs_f64()));
        } else {
            output.push(format!("运行时间: {:.2}秒", duration.as_secs_f64()));
        }

        if let Some(exit_code) = state.exit_code {
            output.push(format!("退出码: {}", exit_code));
        }

        output.push(format!("工作目录: {}", state.working_directory.display()));
        output.push(format!("输出文件: {}", output_file));
        output.push(format!("会话 ID: {}", state.session_id));

        // 获取任务输出
        match self.task_manager.get_output(&input.task_id, None).await {
            Ok(task_output) => {
                output.push("\n=== 任务输出 ===".to_string());
                if task_output.trim().is_empty() {
                    output.push("（暂无输出）".to_string());
                } else {
                    output.push(task_output);
                }
            }
            Err(e) => {
                output.push("\n=== 输出获取失败 ===".to_string());
                output.push(format!("错误: {}", e));
            }
        }

        // 根据任务状态添加状态说明
        match state.status {
            super::task::TaskStatus::Running => {
                output.push("\n=== 状态说明 ===".to_string());
                output.push(
                    "任务仍在运行中。优先直接读取输出文件；如需继续等待，可使用 block=true。"
                        .to_string(),
                );
            }
            super::task::TaskStatus::Completed => {
                output.push("\n=== 状态说明 ===".to_string());
                output.push("任务已成功完成。".to_string());
            }
            super::task::TaskStatus::Failed => {
                output.push("\n=== 状态说明 ===".to_string());
                output.push("任务执行失败。请检查命令和输出错误信息。".to_string());
            }
            super::task::TaskStatus::TimedOut => {
                output.push("\n=== 状态说明 ===".to_string());
                output.push("任务因超时被终止。".to_string());
            }
            super::task::TaskStatus::Killed => {
                output.push("\n=== 状态说明 ===".to_string());
                output.push("任务被用户终止。".to_string());
            }
        }

        Ok(ToolResult::success(output.join("\n"))
            .with_metadata("task_id", serde_json::json!(input.task_id))
            .with_metadata("status", serde_json::json!(state.status.to_string()))
            .with_metadata("duration", serde_json::json!(duration.as_secs_f64()))
            .with_metadata("exit_code", serde_json::json!(state.exit_code))
            .with_metadata("output_file", serde_json::json!(output_file))
            .with_metadata("retrieval_status", serde_json::json!(retrieval_status)))
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        // 查询任务输出是只读操作
        PermissionCheckResult::allow()
    }
}

/// 格式化 Instant 为可读字符串
/// 注意：Instant 不能直接转换为绝对时间，这里只显示相对时间
fn format_instant(instant: std::time::Instant) -> String {
    let elapsed = instant.elapsed();
    format!("{:.2}秒前", elapsed.as_secs_f64())
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

    #[tokio::test]
    async fn test_task_output_tool_new() {
        let tool = TaskOutputTool::new();
        assert_eq!(tool.name(), "TaskOutput");
    }

    #[tokio::test]
    async fn test_task_output_tool_input_schema() {
        let tool = TaskOutputTool::new();
        let schema = tool.input_schema();

        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["task_id"].is_object());
        assert!(schema["properties"]["block"].is_object());
        assert!(schema["properties"]["timeout"].is_object());
        assert!(schema["properties"]["show_history"].is_null());
        assert!(schema["properties"]["lines"].is_null());
        assert_eq!(schema["additionalProperties"], serde_json::json!(false));
        assert_eq!(schema["required"], serde_json::json!(["task_id"]));
    }

    #[tokio::test]
    async fn test_task_output_tool_not_found() {
        let tool = TaskOutputTool::new();
        let context = create_test_context();

        let params = serde_json::json!({
            "task_id": "nonexistent-task"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::NotFound(_)));
    }

    #[tokio::test]
    async fn test_task_output_tool_with_task() {
        let temp_dir = TempDir::new().unwrap();
        let task_manager = Arc::new(
            TaskManager::new()
                .with_output_directory(temp_dir.path().to_path_buf())
                .with_max_concurrent(5),
        );
        let tool = TaskOutputTool::with_manager(task_manager.clone());
        let context = create_test_context();

        // 先启动一个任务
        let task_id = task_manager.start("echo hello", &context).await.unwrap();

        // 等待任务完成
        tokio::time::sleep(Duration::from_millis(500)).await;

        // 查询任务输出
        let params = serde_json::json!({
            "task_id": task_id
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());

        let tool_result = result.unwrap();
        assert!(tool_result.success);
        assert!(tool_result.output.as_ref().unwrap().contains(&task_id));
        assert!(tool_result.metadata.contains_key("status"));
        assert_eq!(
            tool_result.metadata.get("retrieval_status"),
            Some(&serde_json::json!("success"))
        );
        assert!(tool_result.metadata.contains_key("output_file"));
    }

    #[tokio::test]
    async fn test_task_output_tool_with_block() {
        let temp_dir = TempDir::new().unwrap();
        let task_manager = Arc::new(
            TaskManager::new()
                .with_output_directory(temp_dir.path().to_path_buf())
                .with_max_concurrent(5),
        );
        let tool = TaskOutputTool::with_manager(task_manager.clone());
        let context = create_test_context();

        // 启动一个快速任务
        let task_id = task_manager
            .start("echo blocking test", &context)
            .await
            .unwrap();

        // 使用阻塞模式查询
        let params = serde_json::json!({
            "task_id": task_id,
            "block": true,
            "timeout": 2000
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());

        let tool_result = result.unwrap();
        assert!(tool_result.success);
        // 应该包含任务输出
        let output = tool_result.output.as_ref().unwrap();
        assert!(output.contains("blocking test") || output.contains("已完成"));
    }

    #[tokio::test]
    async fn test_task_output_tool_invalid_params() {
        let tool = TaskOutputTool::new();
        let context = create_test_context();

        let params = serde_json::json!({
            "invalid": "params"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_task_output_tool_rejects_legacy_extra_fields() {
        let tool = TaskOutputTool::new();
        let context = create_test_context();

        let params = serde_json::json!({
            "task_id": "nonexistent-task",
            "show_history": true
        });

        let result = tool.execute(params, &context).await;
        assert!(matches!(result, Err(ToolError::InvalidParams(_))));
    }

    #[tokio::test]
    async fn test_task_output_tool_check_permissions() {
        let tool = TaskOutputTool::new();
        let context = create_test_context();
        let params = serde_json::json!({"task_id": "test"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
    }
}
