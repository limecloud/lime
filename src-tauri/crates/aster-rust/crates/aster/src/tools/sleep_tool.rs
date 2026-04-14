//! Sleep current surface tool
//!
//! 对齐当前工具面：
//! - Sleep

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolOptions, ToolResult};
use super::error::ToolError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const SLEEP_TOOL_NAME: &str = "Sleep";
const SLEEP_TOOL_DESCRIPTION: &str = "Wait for a specified duration";
const SLEEP_TOOL_BASE_TIMEOUT_SECS: u64 = 24 * 60 * 60;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SleepToolInput {
    duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SleepToolOutput {
    success: bool,
    duration_ms: u64,
    elapsed_ms: u64,
}

pub struct SleepTool;

impl SleepTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SleepTool {
    fn default() -> Self {
        Self::new()
    }
}

fn dynamic_description() -> String {
    [
        SLEEP_TOOL_DESCRIPTION.to_string(),
        String::new(),
        "The user can interrupt the sleep at any time.".to_string(),
        String::new(),
        "Use this when the user tells you to sleep or rest, when you have nothing to do, or when you're waiting for something.".to_string(),
        String::new(),
        "You may receive <tick> prompts - these are periodic check-ins. Look for useful work to do before sleeping.".to_string(),
        String::new(),
        "You can call this concurrently with other tools - it won't interfere with them.".to_string(),
        String::new(),
        "Prefer this over `Bash(sleep ...)` - it doesn't hold a shell process.".to_string(),
        String::new(),
        "Each wake-up costs an API call, but the prompt cache expires after 5 minutes of inactivity - balance accordingly.".to_string(),
    ]
    .join("\n")
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| ToolError::execution_failed(format!("序列化 Sleep 结果失败: {error}")))
}

fn elapsed_ms(started_at: Instant) -> u64 {
    started_at
        .elapsed()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[async_trait]
impl Tool for SleepTool {
    fn name(&self) -> &str {
        SLEEP_TOOL_NAME
    }

    fn description(&self) -> &str {
        SLEEP_TOOL_DESCRIPTION
    }

    fn dynamic_description(&self) -> Option<String> {
        Some(dynamic_description())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "durationMs": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "The duration to wait, in milliseconds."
                }
            },
            "required": ["durationMs"]
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(0)
            .with_base_timeout(Duration::from_secs(SLEEP_TOOL_BASE_TIMEOUT_SECS))
            .with_dynamic_timeout(false)
    }

    async fn check_permissions(
        &self,
        _params: &Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        let input: SleepToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        let started_at = Instant::now();
        let duration = Duration::from_millis(input.duration_ms);

        if let Some(token) = context.cancellation_token.as_ref() {
            tokio::select! {
                _ = tokio::time::sleep(duration) => {}
                _ = token.cancelled() => return Err(ToolError::Cancelled),
            }
        } else {
            tokio::time::sleep(duration).await;
        }

        let elapsed_ms = elapsed_ms(started_at);
        let output = SleepToolOutput {
            success: true,
            duration_ms: input.duration_ms,
            elapsed_ms,
        };

        Ok(ToolResult::success(pretty_json(&output)?)
            .with_metadata("success", json!(true))
            .with_metadata("durationMs", json!(input.duration_ms))
            .with_metadata("elapsedMs", json!(elapsed_ms)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_util::sync::CancellationToken;

    fn parse_output(result: ToolResult) -> SleepToolOutput {
        serde_json::from_str(result.output.as_deref().expect("expected tool output"))
            .expect("expected valid Sleep output json")
    }

    #[test]
    fn test_sleep_tool_definition() {
        let tool = SleepTool::new();
        let definition = tool.get_definition();

        assert_eq!(definition.name, SLEEP_TOOL_NAME);
        assert!(definition
            .description
            .contains("Prefer this over `Bash(sleep ...)`"));
        assert_eq!(
            definition
                .input_schema
                .get("required")
                .and_then(Value::as_array)
                .expect("required array"),
            &vec![Value::String("durationMs".to_string())]
        );
    }

    #[tokio::test]
    async fn test_sleep_tool_execute_success() {
        let tool = SleepTool::new();

        let result = tool
            .execute(json!({ "durationMs": 5 }), &ToolContext::default())
            .await
            .expect("sleep should succeed");
        let output = parse_output(result.clone());

        assert!(output.success);
        assert_eq!(output.duration_ms, 5);
        assert!(output.elapsed_ms >= 5);
        assert_eq!(result.metadata.get("durationMs"), Some(&json!(5)));
        assert_eq!(result.metadata.get("success"), Some(&json!(true)));
    }

    #[tokio::test]
    async fn test_sleep_tool_execute_cancelled() {
        let tool = SleepTool::new();
        let token = CancellationToken::new();
        let context = ToolContext::default().with_cancellation_token(token.clone());
        let execute_future = tool.execute(json!({ "durationMs": 200 }), &context);

        tokio::pin!(execute_future);

        tokio::time::sleep(Duration::from_millis(10)).await;
        token.cancel();

        let error = execute_future.await.expect_err("sleep should be cancelled");
        assert!(matches!(error, ToolError::Cancelled));
    }

    #[test]
    fn test_sleep_tool_options() {
        let tool = SleepTool::new();
        let options = tool.options();

        assert_eq!(options.max_retries, 0);
        assert_eq!(
            options.base_timeout,
            Duration::from_secs(SLEEP_TOOL_BASE_TIMEOUT_SECS)
        );
        assert!(!options.enable_dynamic_timeout);
    }
}
