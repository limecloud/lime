use super::super::McpStepSnapshot;
use super::{DiscoveryMode, TestConnection};
use crate::mcp_connection::{
    McpCallScope, McpConnectionHandle, McpConnectionProvenance, McpConnectionRegistry,
};
use crate::tool_extension::{RuntimeExtensionConfig, RuntimeToolCaller};
use rmcp::model::{CallToolRequestParams, CallToolResult, JsonObject, Tool};
use std::collections::HashSet;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

pub(super) async fn register(registry: &McpConnectionRegistry, tools: Vec<&str>, output: &str) {
    let config = RuntimeExtensionConfig::new(
        "docs",
        "Docs tools",
        tools.iter().map(|name| (*name).to_string()).collect(),
        false,
        tools.iter().map(|name| (*name).to_string()).collect(),
        None,
    );
    register_connection(
        registry,
        "docs",
        config,
        tools.into_iter().map(|name| tool(name, None)).collect(),
        output,
        DiscoveryMode::Ready,
        Arc::new(AtomicUsize::new(0)),
    )
    .await;
}

pub(super) async fn register_named(
    registry: &McpConnectionRegistry,
    name: &str,
    discovery_mode: DiscoveryMode,
) {
    let config = RuntimeExtensionConfig::new(
        name,
        format!("{name} tools"),
        vec!["search".to_string()],
        false,
        vec!["search".to_string()],
        None,
    );
    register_connection(
        registry,
        name,
        config,
        vec![tool("search", None)],
        name,
        discovery_mode,
        Arc::new(AtomicUsize::new(0)),
    )
    .await;
}

pub(super) async fn register_connection(
    registry: &McpConnectionRegistry,
    name: &str,
    config: RuntimeExtensionConfig,
    tools: Vec<Tool>,
    output: &str,
    discovery_mode: DiscoveryMode,
    call_count: Arc<AtomicUsize>,
) -> McpConnectionHandle {
    let connection: McpConnectionHandle = Arc::new(Mutex::new(Box::new(TestConnection {
        tools,
        output: output.to_string(),
        discovery_mode,
        call_count,
        observed_scope: None,
    })));
    registry
        .register(
            name.to_string(),
            config,
            McpConnectionProvenance::default(),
            false,
            Arc::clone(&connection),
        )
        .await;
    connection
}

pub(super) async fn snapshot(
    registry: &McpConnectionRegistry,
    selected_deferred_tools: HashSet<String>,
    discovery_timeout: Duration,
) -> McpStepSnapshot {
    snapshot_for_caller(
        registry,
        RuntimeToolCaller::assistant(),
        selected_deferred_tools,
        discovery_timeout,
    )
    .await
}

pub(super) async fn snapshot_for_caller(
    registry: &McpConnectionRegistry,
    caller: RuntimeToolCaller,
    selected_deferred_tools: HashSet<String>,
    discovery_timeout: Duration,
) -> McpStepSnapshot {
    registry
        .step_snapshot(None, caller, selected_deferred_tools, discovery_timeout)
        .await
}

pub(super) fn tool(name: &str, allowed_callers: Option<&[&str]>) -> Tool {
    let input_schema = allowed_callers.map_or_else(JsonObject::new, |allowed_callers| {
        serde_json::json!({
            "type": "object",
            "x-lime": { "allowed_callers": allowed_callers }
        })
        .as_object()
        .expect("tool schema object")
        .clone()
    });
    Tool::new(
        name.to_string(),
        format!("{name} tool"),
        Arc::new(input_schema),
    )
}

pub(super) fn call(name: &str) -> CallToolRequestParams {
    CallToolRequestParams::new(name.to_string())
}

pub(super) fn scope() -> McpCallScope {
    McpCallScope::new(Some("turn-1")).expect("turn correlation")
}

pub(super) fn result_text(result: &CallToolResult) -> String {
    serde_json::to_string(result).expect("serialize result")
}
