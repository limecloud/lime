use super::{McpCallScope, McpConnectionCall, McpConnectionHandle, McpConnectionProvenance};
use crate::tool_extension::{RuntimeExtensionConfig, RuntimeToolCaller};
use lime_core::tool_calling::extract_tool_surface_metadata;
use rmcp::model::{CallToolRequestParam, ErrorCode, ErrorData, Tool};
use rmcp::service::ServiceError;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
struct McpStepRoute {
    server_name: String,
    tool_name: String,
    app_context: Option<McpStepRouteAppContext>,
    mcp_app_resource_uri: Option<String>,
    allowed_callers: Option<Vec<String>>,
    provenance: McpConnectionProvenance,
    supports_parallel_tool_calls: bool,
    connection: McpConnectionHandle,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct McpStepRouteAppContext {
    pub connector_id: String,
    pub link_id: Option<String>,
    pub resource_uri: Option<String>,
    pub app_name: Option<String>,
    pub action_name: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct McpStepRouteIdentity {
    pub server_name: String,
    pub tool_name: String,
    pub runtime_tool_name: String,
    pub app_context: Option<McpStepRouteAppContext>,
    pub mcp_app_resource_uri: Option<String>,
    pub plugin_id: Option<String>,
}

#[derive(Clone)]
pub struct McpStepSnapshot {
    caller: RuntimeToolCaller,
    generation: u64,
    tools: Arc<Vec<Tool>>,
    routes: Arc<HashMap<String, McpStepRoute>>,
}

impl McpStepSnapshot {
    pub fn empty(caller: RuntimeToolCaller) -> Self {
        Self {
            caller,
            generation: 0,
            tools: Arc::new(Vec::new()),
            routes: Arc::new(HashMap::new()),
        }
    }

    /// Generation of the connection registry captured for this sampling step.
    ///
    /// The snapshot remains immutable even when the registry changes; callers can use this
    /// value to correlate tool exposure and execution evidence with the captured registry state.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn tools(&self) -> &[Tool] {
        self.tools.as_ref()
    }

    pub fn supports_parallel_tool_calls(&self, tool_name: &str) -> bool {
        self.routes
            .get(tool_name)
            .is_some_and(|route| route.supports_parallel_tool_calls)
    }

    pub fn environment_id(&self, tool_name: &str) -> Option<&str> {
        self.routes
            .get(tool_name)
            .map(|route| route.provenance.environment_id())
    }

    pub fn route_identity(&self, runtime_tool_name: &str) -> Option<McpStepRouteIdentity> {
        self.routes
            .get(runtime_tool_name)
            .map(|route| McpStepRouteIdentity {
                server_name: route.server_name.clone(),
                tool_name: route.tool_name.clone(),
                runtime_tool_name: runtime_tool_name.to_string(),
                app_context: route.app_context.clone(),
                mcp_app_resource_uri: route.mcp_app_resource_uri.clone(),
                plugin_id: route.provenance.plugin_id().map(ToOwned::to_owned),
            })
    }

    /// 返回排除指定 MCP server 的不可变 step snapshot。
    pub fn without_server(&self, server_name: &str) -> Self {
        let routes = self
            .routes
            .iter()
            .filter(|(_, route)| route.server_name != server_name)
            .map(|(name, route)| (name.clone(), route.clone()))
            .collect::<HashMap<_, _>>();
        let tools = self
            .tools
            .iter()
            .filter(|tool| routes.contains_key(tool.name.as_ref()))
            .cloned()
            .collect::<Vec<_>>();
        Self {
            caller: self.caller.clone(),
            generation: self.generation,
            tools: Arc::new(tools),
            routes: Arc::new(routes),
        }
    }

    pub async fn dispatch(
        &self,
        tool_call: CallToolRequestParam,
        scope: McpCallScope,
        cancellation_token: CancellationToken,
    ) -> Result<McpConnectionCall, ErrorData> {
        let Some(route) = self.routes.get(tool_call.name.as_ref()).cloned() else {
            return Err(ErrorData::new(
                ErrorCode::RESOURCE_NOT_FOUND,
                tool_call.name,
                None,
            ));
        };
        if !self.caller.is_allowed(route.allowed_callers.as_deref()) {
            return Err(ErrorData::new(
                ErrorCode::RESOURCE_NOT_FOUND,
                tool_call.name,
                None,
            ));
        }

        let scope = scope
            .with_snapshot_generation(self.generation)
            .with_environment_id(route.provenance.environment_id().to_string())
            .with_auth_scopes(
                route
                    .provenance
                    .auth_scopes()
                    .map(ToOwned::to_owned)
                    .unwrap_or_default(),
            );
        let call = route
            .connection
            .lock()
            .await
            .start_call_tool(
                &route.tool_name,
                tool_call.arguments,
                &scope,
                cancellation_token,
            )
            .await
            .map_err(service_error_data);
        call
    }

    pub(super) async fn capture(
        connections: Vec<(
            String,
            RuntimeExtensionConfig,
            McpConnectionProvenance,
            bool,
            McpConnectionHandle,
        )>,
        selected_deferred_tools: HashSet<String>,
        caller: RuntimeToolCaller,
        discovery_timeout: Duration,
        generation: u64,
    ) -> Self {
        let mut tools = Vec::new();
        let mut routes = HashMap::new();
        let discovery = ToolDiscoveryContext {
            selected_deferred_tools: Arc::new(selected_deferred_tools),
            caller: caller.clone(),
            timeout: discovery_timeout,
        };
        let mut pending = JoinSet::new();
        for (connection_name, config, provenance, supports_parallel_tool_calls, connection) in
            connections
        {
            let discovery = discovery.clone();
            pending.spawn(async move {
                capture_connection(
                    connection_name,
                    config,
                    provenance,
                    supports_parallel_tool_calls,
                    connection,
                    discovery,
                )
                .await
            });
        }
        while let Some(result) = pending.join_next().await {
            let Ok(Some(captured)) = result else {
                continue;
            };
            for (tool, route) in captured.entries {
                let prefixed_name = tool.name.to_string();
                if routes.insert(prefixed_name, route).is_none() {
                    tools.push(tool);
                }
            }
        }
        tools.sort_by(|left, right| left.name.cmp(&right.name));
        Self {
            caller,
            generation,
            tools: Arc::new(tools),
            routes: Arc::new(routes),
        }
    }
}

struct CapturedConnectionTools {
    entries: Vec<(Tool, McpStepRoute)>,
}

#[derive(Clone)]
struct ToolDiscoveryContext {
    selected_deferred_tools: Arc<HashSet<String>>,
    caller: RuntimeToolCaller,
    timeout: Duration,
}

async fn capture_connection(
    connection_name: String,
    config: RuntimeExtensionConfig,
    provenance: McpConnectionProvenance,
    supports_parallel_tool_calls: bool,
    connection: McpConnectionHandle,
    discovery: ToolDiscoveryContext,
) -> Option<CapturedConnectionTools> {
    let ToolDiscoveryContext {
        selected_deferred_tools,
        caller,
        timeout: discovery_timeout,
    } = discovery;
    let cancellation_token = CancellationToken::new();
    let discovery = async {
        let connection_guard = connection.lock().await;
        let mut page = connection_guard
            .list_tools(None, cancellation_token.clone())
            .await?;
        let mut entries = Vec::new();
        let mut seen = HashSet::new();
        loop {
            for tool in page.tools {
                let tool_name = tool.name.to_string();
                let mcp_app_resource_uri = mcp_app_resource_uri(&tool);
                let server_name = provenance
                    .server_name()
                    .unwrap_or(&connection_name)
                    .to_string();
                let app_context =
                    mcp_app_context(&server_name, &tool, mcp_app_resource_uri.clone());
                let prefixed_name = format!("{connection_name}__{tool_name}");
                let visible = config.is_tool_exposed_by_default(&tool.name)
                    || selected_deferred_tools.contains(&prefixed_name);
                let allowed_callers = tool_allowed_callers(&tool, &config);
                if !config.is_tool_available(&tool.name)
                    || !visible
                    || !caller.is_allowed(allowed_callers.as_deref())
                    || !seen.insert(prefixed_name.clone())
                {
                    continue;
                }
                let tool_supports_parallel = supports_parallel_tool_calls
                    || tool
                        .annotations
                        .as_ref()
                        .and_then(|annotations| annotations.read_only_hint)
                        .unwrap_or(false);
                entries.push((
                    Tool {
                        name: prefixed_name.into(),
                        description: tool.description,
                        input_schema: tool.input_schema,
                        annotations: tool.annotations,
                        output_schema: tool.output_schema,
                        icons: tool.icons,
                        title: tool.title,
                        meta: tool.meta,
                    },
                    McpStepRoute {
                        server_name,
                        tool_name,
                        app_context,
                        mcp_app_resource_uri,
                        allowed_callers,
                        provenance: provenance.clone(),
                        supports_parallel_tool_calls: tool_supports_parallel,
                        connection: Arc::clone(&connection),
                    },
                ));
            }
            let Some(cursor) = page.next_cursor else {
                break;
            };
            page = connection_guard
                .list_tools(Some(cursor), cancellation_token.clone())
                .await?;
        }
        Ok::<_, ServiceError>(CapturedConnectionTools { entries })
    };

    match tokio::time::timeout(discovery_timeout, discovery).await {
        Ok(Ok(captured)) => Some(captured),
        Ok(Err(_)) => None,
        Err(_) => {
            cancellation_token.cancel();
            None
        }
    }
}

fn mcp_app_resource_uri(tool: &Tool) -> Option<String> {
    let meta = tool.meta.as_ref()?;
    meta.get("ui")
        .and_then(Value::as_object)
        .and_then(|ui| ui.get("resourceUri"))
        .and_then(Value::as_str)
        .or_else(|| meta.get("ui/resourceUri").and_then(Value::as_str))
        .or_else(|| meta.get("openai/outputTemplate").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn mcp_app_context(
    server_name: &str,
    tool: &Tool,
    resource_uri: Option<String>,
) -> Option<McpStepRouteAppContext> {
    if server_name != "lime_apps" {
        return None;
    }
    let meta = tool.meta.as_ref()?;
    let connector_id = non_empty_meta_string(meta, "connector_id")?;
    let lime_apps = meta.get("_lime_apps").and_then(Value::as_object);
    let action_name = lime_apps
        .and_then(|value| value.get("resource_uri"))
        .and_then(Value::as_str)
        .map(str::trim)
        .and_then(|value| value.trim_matches('/').rsplit('/').next())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    Some(McpStepRouteAppContext {
        connector_id,
        link_id: non_empty_meta_string(meta, "link_id"),
        resource_uri,
        app_name: non_empty_meta_string(meta, "connector_name"),
        action_name,
    })
}

fn non_empty_meta_string(meta: &rmcp::model::Meta, key: &str) -> Option<String> {
    meta.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn tool_allowed_callers(tool: &Tool, config: &RuntimeExtensionConfig) -> Option<Vec<String>> {
    extract_tool_surface_metadata(
        tool.name.as_ref(),
        &Value::Object((*tool.input_schema).clone()),
    )
    .allowed_callers
    .or_else(|| {
        config
            .allowed_caller()
            .map(|caller| vec![caller.to_string()])
    })
}

fn service_error_data(error: ServiceError) -> ErrorData {
    match error {
        ServiceError::McpError(error) => error,
        error => ErrorData::new(ErrorCode::INTERNAL_ERROR, error.to_string(), None),
    }
}

#[cfg(test)]
mod tests;
