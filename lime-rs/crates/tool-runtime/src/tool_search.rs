use crate::tool_definition::RuntimeToolDefinition;
use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionRequest,
    RuntimeToolExecutionResult, RuntimeToolExecutor, RuntimeToolExecutorHandle,
    RuntimeToolPolicyErrorKind,
};
use app_server_protocol::{McpToolListResponse, McpToolSearchParams};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;

pub const TOOL_SEARCH_TOOL_NAME: &str = "tool_search";
pub const TOOL_SEARCH_CALLER: &str = "tool_search";

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeToolSearchInput {
    query: String,
    #[serde(default = "default_max_results", alias = "maxResults")]
    max_results: usize,
}

#[async_trait]
pub trait ToolSearchGateway: Send + Sync {
    async fn search_tools(
        &self,
        params: McpToolSearchParams,
    ) -> Result<McpToolListResponse, String>;
}

pub struct RuntimeToolSearchExecutor {
    gateway: Arc<dyn ToolSearchGateway>,
}

impl RuntimeToolSearchExecutor {
    pub fn new(gateway: Arc<dyn ToolSearchGateway>) -> Self {
        Self { gateway }
    }
}

impl RuntimeToolExecutor for RuntimeToolSearchExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move {
            if request.tool_name != TOOL_SEARCH_TOOL_NAME {
                return Err(RuntimeToolExecutionError::new(
                    format!("unsupported tool search tool: {}", request.tool_name),
                    Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                        "unsupported_tool_search_tool".to_string(),
                    )),
                ));
            }

            let input = parse_tool_search_input(request.params)?;
            let query = input.query.trim();
            if query.is_empty() {
                return Err(RuntimeToolExecutionError::new(
                    "query 不能为空",
                    Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                        "invalid_tool_search_query".to_string(),
                    )),
                ));
            }

            let response = self
                .gateway
                .search_tools(McpToolSearchParams {
                    query: query.to_string(),
                    caller: Some(TOOL_SEARCH_CALLER.to_string()),
                    limit: input.max_results.max(1),
                })
                .await
                .map_err(|error| {
                    RuntimeToolExecutionError::new(
                        error,
                        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                            "tool_search_gateway_failed".to_string(),
                        )),
                    )
                })?;

            Ok(tool_search_result(query, response))
        })
    }
}

pub fn tool_search_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        TOOL_SEARCH_TOOL_NAME,
        "Fetch full schema definitions for deferred extension/MCP tools so they can be called. Use select:<tool_name> for direct selection, or keywords like browser click / +playwright click.",
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Query to find deferred extension/MCP tools. Use select:<tool_name>[,<tool_name>] for direct selection."
                },
                "max_results": {
                    "type": "number",
                    "description": "Maximum number of results to return for keyword search (default: 5)"
                }
            },
            "required": ["query"],
            "additionalProperties": false
        }),
    )
}

pub fn runtime_tool_search_executor_handle(
    gateway: Arc<dyn ToolSearchGateway>,
) -> RuntimeToolExecutorHandle {
    RuntimeToolExecutorHandle::new(Arc::new(RuntimeToolSearchExecutor::new(gateway)))
}

pub fn check_runtime_tool_search_permissions() -> Result<(), RuntimeToolExecutionError> {
    Ok(())
}

fn default_max_results() -> usize {
    5
}

fn parse_tool_search_input(
    params: &Value,
) -> Result<RuntimeToolSearchInput, RuntimeToolExecutionError> {
    serde_json::from_value(params.clone()).map_err(|error| {
        RuntimeToolExecutionError::new(
            format!("参数解析失败: {error}"),
            Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                "invalid_tool_search_params".to_string(),
            )),
        )
    })
}

fn tool_search_result(query: &str, response: McpToolListResponse) -> RuntimeToolExecutionResult {
    let tools = response.tools;
    let matches = tools.iter().filter_map(tool_name).collect::<Vec<_>>();
    let notes = build_tool_search_notes(query, &matches);
    let retry_allowed = retry_allowed_for_tool_search(&matches);
    let terminal_reason = terminal_reason_for_tool_search(&matches);
    let next_action = build_tool_search_next_action(query, &matches);
    let count = matches.len();
    let total_deferred_tools = count;

    let output = json!({
        "tools": tools,
        "matches": matches,
        "count": count,
        "query": query,
        "caller": TOOL_SEARCH_CALLER,
        "total_deferred_tools": total_deferred_tools,
        "notes": notes,
        "retry_allowed": retry_allowed,
        "terminal_reason": terminal_reason,
        "next_action": next_action,
    });

    let mut metadata = HashMap::new();
    metadata.insert("matches".to_string(), output["matches"].clone());
    metadata.insert("count".to_string(), json!(count));
    metadata.insert("query".to_string(), json!(query));
    metadata.insert("caller".to_string(), json!(TOOL_SEARCH_CALLER));
    metadata.insert(
        "total_deferred_tools".to_string(),
        json!(total_deferred_tools),
    );
    metadata.insert("notes".to_string(), output["notes"].clone());
    metadata.insert("tool_search_result_count".to_string(), json!(count));
    metadata.insert(
        "tool_search_retry_allowed".to_string(),
        json!(retry_allowed),
    );
    metadata.insert("terminal_reason".to_string(), json!(terminal_reason));
    metadata.insert("next_action".to_string(), json!(next_action));
    metadata.insert("tool_surface_updated".to_string(), json!(false));

    RuntimeToolExecutionResult::new(true, output.to_string(), None, metadata)
}

fn tool_name(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            let object = value.as_object()?;
            ["name", "call_name", "callName", "tool_name"]
                .iter()
                .find_map(|key| object.get(*key)?.as_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToOwned::to_owned)
        })
}

fn build_tool_search_notes(query: &str, matches: &[String]) -> Vec<String> {
    if !matches.is_empty() || query.trim().is_empty() {
        return Vec::new();
    }

    if is_select_query(query) {
        vec!["未命中任何工具，这是终态搜索结果。不要继续用同义词反复重试；优先直接调用当前已可见的原生工具。".to_string()]
    } else {
        vec!["未命中任何 deferred 工具，这是终态搜索结果。若需要文件、命令、网页或最终答复能力，请直接调用当前已可见的原生工具，而不是继续改写同义词搜索。".to_string()]
    }
}

fn build_tool_search_next_action(query: &str, matches: &[String]) -> Option<String> {
    if !matches.is_empty() {
        return None;
    }

    if is_select_query(query) {
        Some("Stop calling tool_search for this selection. If the requested deferred tool is unavailable, ask the user to enable or configure the corresponding MCP server.".to_string())
    } else {
        Some("Stop calling tool_search for this capability. Use already-visible native tools directly, or answer that no matching deferred extension/MCP tool is available.".to_string())
    }
}

fn terminal_reason_for_tool_search(matches: &[String]) -> Option<String> {
    matches
        .is_empty()
        .then(|| "no_deferred_tool_match".to_string())
}

fn retry_allowed_for_tool_search(matches: &[String]) -> Option<bool> {
    matches.is_empty().then_some(false)
}

fn is_select_query(query: &str) -> bool {
    query
        .trim()
        .get(.."select:".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("select:"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Default)]
    struct FakeToolSearchGateway;

    #[async_trait]
    impl ToolSearchGateway for FakeToolSearchGateway {
        async fn search_tools(
            &self,
            _params: McpToolSearchParams,
        ) -> Result<McpToolListResponse, String> {
            Ok(McpToolListResponse {
                tools: vec![json!({
                    "name": "mcp__browser__click",
                    "description": "Click an element",
                    "source": "extension",
                    "status": "deferred"
                })],
            })
        }
    }

    #[tokio::test]
    async fn tool_search_executor_returns_frontend_summary_shape() {
        let executor = RuntimeToolSearchExecutor::new(Arc::new(FakeToolSearchGateway));
        let context = crate::tool_executor::RuntimeToolExecutionContext::new(
            crate::tool_executor::RuntimeToolExecutionContextInput {
                working_directory: ".".into(),
                session_id: "session-tool-search".to_string(),
                cancel_token: None,
                workspace_sandbox: None,
            },
        );

        let result = executor
            .execute(RuntimeToolExecutionRequest {
                tool_name: TOOL_SEARCH_TOOL_NAME,
                params: &json!({ "query": "browser click" }),
                context: &context,
                turn_context: None,
            })
            .await
            .expect("tool search should execute");

        assert!(result.success);
        let output: Value = serde_json::from_str(&result.output).expect("json output");
        assert_eq!(output["query"], json!("browser click"));
        assert_eq!(output["caller"], json!(TOOL_SEARCH_CALLER));
        assert_eq!(output["matches"], json!(["mcp__browser__click"]));
        assert!(output["tools"].is_array());
        assert_eq!(
            result.metadata.get("tool_search_result_count"),
            Some(&json!(1))
        );
    }
}
