use crate::tool_definition::RuntimeToolDefinition;
use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionRequest,
    RuntimeToolExecutionResult, RuntimeToolExecutor, RuntimeToolExecutorHandle,
    RuntimeToolPolicyErrorKind,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

pub const SLEEP_TOOL_NAME: &str = "sleep";
pub const CLOCK_SLEEP_TOOL_NAME: &str = "clock.sleep";
pub const MAX_SLEEP_DURATION_MS: u64 = 12 * 60 * 60 * 1000;

#[derive(Debug, Default)]
pub struct RuntimeSleepExecutor;

impl RuntimeSleepExecutor {
    pub fn new() -> Self {
        Self
    }

    pub fn handle() -> RuntimeToolExecutorHandle {
        RuntimeToolExecutorHandle::new(Arc::new(Self::new()))
    }

    async fn execute_sleep(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        if request.tool_name != SLEEP_TOOL_NAME && request.tool_name != CLOCK_SLEEP_TOOL_NAME {
            return Err(runtime_sleep_error(format!(
                "sleep executor cannot run tool '{}'",
                request.tool_name
            )));
        }

        let input = parse_input(request.params.clone())?;
        let started = Instant::now();
        let mut interrupted = false;

        if let Some(cancel_token) = request.context.cancel_token() {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(input.duration_ms)) => {}
                _ = cancel_token.cancelled() => {
                    interrupted = true;
                }
            }
        } else {
            tokio::time::sleep(Duration::from_millis(input.duration_ms)).await;
        }

        let elapsed_ms = started.elapsed().as_millis() as u64;
        let message = if interrupted {
            "Sleep interrupted."
        } else {
            "Sleep completed."
        };
        let output = format!(
            "Wall time: {:.4} seconds\n{message}",
            started.elapsed().as_secs_f64()
        );
        let metadata = HashMap::from([
            ("tool_family".to_string(), json!("sleep")),
            ("duration_ms".to_string(), json!(input.duration_ms)),
            ("elapsed_ms".to_string(), json!(elapsed_ms)),
            ("interrupted".to_string(), json!(interrupted)),
        ]);

        Ok(RuntimeToolExecutionResult::new(
            true, output, None, metadata,
        ))
    }
}

impl RuntimeToolExecutor for RuntimeSleepExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move { self.execute_sleep(request).await })
    }
}

pub fn runtime_sleep_executor_handle() -> RuntimeToolExecutorHandle {
    static HANDLE: OnceLock<RuntimeToolExecutorHandle> = OnceLock::new();
    HANDLE.get_or_init(RuntimeSleepExecutor::handle).clone()
}

pub fn sleep_tool_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        SLEEP_TOOL_NAME,
        "Pause execution for a specified duration. Returns the elapsed wall-clock time. The sleep can end early when the active tool call is cancelled.",
        sleep_tool_input_schema(),
    )
}

pub fn sleep_tool_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "duration_ms": {
                "type": "integer",
                "minimum": 1,
                "maximum": MAX_SLEEP_DURATION_MS,
                "description": format!("How long to sleep in milliseconds. Must be between 1 and {MAX_SLEEP_DURATION_MS}.")
            }
        },
        "required": ["duration_ms"],
        "additionalProperties": false
    })
}

pub fn check_runtime_sleep_permissions(params: &Value) -> Result<(), RuntimeToolExecutionError> {
    parse_input(params.clone()).map(|_| ())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SleepInput {
    duration_ms: u64,
}

fn parse_input(params: Value) -> Result<SleepInput, RuntimeToolExecutionError> {
    let input: SleepInput = serde_json::from_value(params)
        .map_err(|error| runtime_sleep_error(format!("sleep 参数无效: {error}")))?;
    if !(1..=MAX_SLEEP_DURATION_MS).contains(&input.duration_ms) {
        return Err(runtime_sleep_error(format!(
            "duration_ms must be between 1 and {MAX_SLEEP_DURATION_MS}"
        )));
    }
    Ok(input)
}

fn runtime_sleep_error(message: impl Into<String>) -> RuntimeToolExecutionError {
    let message = message.into();
    RuntimeToolExecutionError::new(
        message.clone(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(message)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_executor::{RuntimeToolExecutionContext, RuntimeToolExecutionContextInput};
    use serde_json::json;
    use std::path::PathBuf;
    use tokio_util::sync::CancellationToken;

    fn context(cancel_token: Option<CancellationToken>) -> RuntimeToolExecutionContext {
        RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
            working_directory: PathBuf::from("/tmp/workspace"),
            session_id: "session-sleep-1".to_string(),
            cancel_token,
            workspace_sandbox: None,
        })
    }

    #[test]
    fn sleep_definition_uses_codex_style_duration_schema() {
        let definition = sleep_tool_definition();

        assert_eq!(definition.name, SLEEP_TOOL_NAME);
        assert_eq!(
            definition.input_schema["properties"]["duration_ms"]["maximum"],
            json!(MAX_SLEEP_DURATION_MS)
        );
        assert_eq!(
            definition.input_schema["additionalProperties"],
            json!(false)
        );
    }

    #[test]
    fn sleep_permission_rejects_agent_free_form_params() {
        let result = check_runtime_sleep_permissions(&json!({
            "seconds": 1
        }));

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn sleep_executor_returns_elapsed_metadata() {
        let runtime_context = context(None);
        let result = runtime_sleep_executor_handle()
            .execute(RuntimeToolExecutionRequest {
                tool_name: SLEEP_TOOL_NAME,
                params: &json!({ "duration_ms": 1 }),
                context: &runtime_context,
                turn_context: None,
            })
            .await
            .expect("sleep execution should succeed");

        assert!(result.success);
        assert_eq!(result.metadata.get("tool_family"), Some(&json!("sleep")));
        assert_eq!(result.metadata.get("duration_ms"), Some(&json!(1)));
        assert_eq!(result.metadata.get("interrupted"), Some(&json!(false)));
    }

    #[tokio::test]
    async fn sleep_executor_ends_on_cancel_token() {
        let cancel_token = CancellationToken::new();
        cancel_token.cancel();
        let runtime_context = context(Some(cancel_token));
        let result = runtime_sleep_executor_handle()
            .execute(RuntimeToolExecutionRequest {
                tool_name: SLEEP_TOOL_NAME,
                params: &json!({ "duration_ms": 60_000 }),
                context: &runtime_context,
                turn_context: None,
            })
            .await
            .expect("cancelled sleep should return an interrupted result");

        assert!(result.success);
        assert_eq!(result.metadata.get("interrupted"), Some(&json!(true)));
    }
}
