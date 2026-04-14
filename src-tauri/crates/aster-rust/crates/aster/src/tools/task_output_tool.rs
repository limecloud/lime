//! TaskOutput Tool - 任务输出查询工具
//!
//! 用于查询后台任务的状态和输出，对齐当前工具面

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolResult};
use super::error::ToolError;
use super::task::TaskManager;
use async_trait::async_trait;
use serde::{de, Deserialize, Deserializer, Serialize};
use std::sync::Arc;
use std::time::Duration;

const TASK_OUTPUT_TOOL_ALIASES: &[&str] = &["TaskOutputTool", "AgentOutputTool", "BashOutputTool"];

/// TaskOutputTool 输入参数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskOutputInput {
    /// 任务 ID
    pub task_id: String,
    /// 是否阻塞等待任务完成
    #[serde(default, deserialize_with = "deserialize_optional_semantic_bool")]
    pub block: Option<bool>,
    /// 等待超时时间（毫秒）
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum SemanticBoolInput {
    Bool(bool),
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskOutputPayload {
    task_id: String,
    task_type: String,
    status: String,
    description: String,
    output: String,
    #[serde(rename = "exitCode", skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskOutputResponse {
    retrieval_status: String,
    task: Option<TaskOutputPayload>,
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

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value).map_err(|error| {
        ToolError::execution_failed(format!("序列化 TaskOutput 结果失败: {error}"))
    })
}

fn deserialize_optional_semantic_bool<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<SemanticBoolInput>::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(SemanticBoolInput::Bool(value)) => Ok(Some(value)),
        Some(SemanticBoolInput::String(raw)) => match raw.trim().to_ascii_lowercase().as_str() {
            "true" => Ok(Some(true)),
            "false" => Ok(Some(false)),
            _ => Err(de::Error::invalid_value(
                de::Unexpected::Str(&raw),
                &"a boolean or the string \"true\"/\"false\"",
            )),
        },
    }
}

#[async_trait]
impl Tool for TaskOutputTool {
    fn name(&self) -> &str {
        "TaskOutput"
    }

    fn aliases(&self) -> &'static [&'static str] {
        TASK_OUTPUT_TOOL_ALIASES
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
                    "minimum": 0,
                    "maximum": 600000,
                    "description": "等待超时时间（毫秒，默认 30000，最大 600000）"
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
        if timeout_ms > 600000 {
            return Err(ToolError::invalid_params("timeout 不能超过 600000 毫秒"));
        }

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

        let duration = state.duration();
        let task_output = match self.task_manager.get_output(&input.task_id, None).await {
            Ok(task_output) => task_output,
            Err(error) => format!("输出获取失败: {error}"),
        };
        let response = TaskOutputResponse {
            retrieval_status: retrieval_status.to_string(),
            task: Some(TaskOutputPayload {
                task_id: input.task_id.clone(),
                task_type: "local_bash".to_string(),
                status: state.status.to_string(),
                description: state.command.clone(),
                output: task_output,
                exit_code: state.exit_code,
            }),
        };

        Ok(ToolResult::success(pretty_json(&response)?)
            .with_metadata("task_id", serde_json::json!(input.task_id))
            .with_metadata("task_type", serde_json::json!("local_bash"))
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
        let output = tool_result.output.as_ref().unwrap();
        assert!(output.contains(&task_id));
        assert!(output.contains("\"task_type\": \"local_bash\""));
        assert!(tool_result.metadata.contains_key("status"));
        assert_eq!(
            tool_result.metadata.get("retrieval_status"),
            Some(&serde_json::json!("success"))
        );
        assert!(tool_result.metadata.contains_key("output_file"));
    }

    #[tokio::test]
    async fn test_task_output_tool_non_blocking_running_task_returns_not_ready() {
        let temp_dir = TempDir::new().unwrap();
        let task_manager = Arc::new(
            TaskManager::new()
                .with_output_directory(temp_dir.path().to_path_buf())
                .with_max_concurrent(5),
        );
        let tool = TaskOutputTool::with_manager(task_manager.clone());
        let context = create_test_context();

        let task_id = task_manager.start("sleep 2", &context).await.unwrap();

        let result = tool
            .execute(
                serde_json::json!({
                    "task_id": task_id,
                    "block": false
                }),
                &context,
            )
            .await
            .unwrap();

        assert!(result.success);
        assert_eq!(
            result.metadata["retrieval_status"],
            serde_json::json!("not_ready")
        );
        assert_eq!(
            result.metadata["task_type"],
            serde_json::json!("local_bash")
        );
        let output = result.output.as_ref().unwrap();
        assert!(output.contains("\"retrieval_status\": \"not_ready\""));
        assert!(output.contains("\"task_type\": \"local_bash\""));
    }

    #[tokio::test]
    async fn test_task_output_tool_blocking_timeout_returns_timeout() {
        let temp_dir = TempDir::new().unwrap();
        let task_manager = Arc::new(
            TaskManager::new()
                .with_output_directory(temp_dir.path().to_path_buf())
                .with_max_concurrent(5),
        );
        let tool = TaskOutputTool::with_manager(task_manager.clone());
        let context = create_test_context();

        let task_id = task_manager.start("sleep 2", &context).await.unwrap();

        let result = tool
            .execute(
                serde_json::json!({
                    "task_id": task_id,
                    "block": true,
                    "timeout": 100
                }),
                &context,
            )
            .await
            .unwrap();

        assert!(result.success);
        assert_eq!(
            result.metadata["retrieval_status"],
            serde_json::json!("timeout")
        );
        let output = result.output.as_ref().unwrap();
        assert!(output.contains("\"retrieval_status\": \"timeout\""));
        assert!(output.contains("\"task_type\": \"local_bash\""));
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
        let output = tool_result.output.as_ref().unwrap();
        assert!(output.contains("blocking test"));
        assert!(output.contains("\"retrieval_status\": \"success\""));
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
    async fn test_task_output_tool_accepts_string_block_flag() {
        let temp_dir = TempDir::new().unwrap();
        let task_manager = Arc::new(
            TaskManager::new()
                .with_output_directory(temp_dir.path().to_path_buf())
                .with_max_concurrent(5),
        );
        let tool = TaskOutputTool::with_manager(task_manager.clone());
        let context = create_test_context();

        let task_id = task_manager.start("sleep 1", &context).await.unwrap();

        let result = tool
            .execute(
                serde_json::json!({
                    "task_id": task_id,
                    "block": "false"
                }),
                &context,
            )
            .await
            .unwrap();

        assert_eq!(
            result.metadata["retrieval_status"],
            serde_json::json!("not_ready")
        );
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
