use super::*;
use crate::mcp_connection::{McpConnection, McpConnectionError, McpConnectionRegistry};
use async_trait::async_trait;
use rmcp::model::{CallToolResult, Content, JsonObject, ListToolsResult, Meta, ToolAnnotations};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Mutex;

mod fixtures;

use fixtures::{
    call, register, register_connection, register_named, result_text, scope, snapshot,
    snapshot_for_caller, tool,
};

#[derive(Clone, Copy)]
enum DiscoveryMode {
    Ready,
    Error,
    Slow,
}

struct TestConnection {
    tools: Vec<Tool>,
    output: String,
    discovery_mode: DiscoveryMode,
    call_count: Arc<AtomicUsize>,
    observed_scope: Option<Arc<Mutex<Option<McpCallScope>>>>,
}

#[async_trait]
impl McpConnection for TestConnection {
    async fn list_tools(
        &self,
        _next_cursor: Option<String>,
        _cancel_token: CancellationToken,
    ) -> Result<ListToolsResult, McpConnectionError> {
        match self.discovery_mode {
            DiscoveryMode::Ready => Ok(ListToolsResult::with_all_items(self.tools.clone())),
            DiscoveryMode::Error => Err(ServiceError::UnexpectedResponse),
            DiscoveryMode::Slow => std::future::pending().await,
        }
    }

    async fn start_call_tool(
        &self,
        name: &str,
        _arguments: Option<JsonObject>,
        scope: &McpCallScope,
        _cancel_token: CancellationToken,
    ) -> Result<McpConnectionCall, McpConnectionError> {
        let observed_scope = self.observed_scope.clone();
        let scope = scope.clone();
        let call_count = Arc::clone(&self.call_count);
        let output = self.output.clone();
        let name = name.to_string();
        Ok(McpConnectionCall {
            response: Box::pin(async move {
                if let Some(observed_scope) = observed_scope {
                    *observed_scope.lock().await = Some(scope);
                }
                call_count.fetch_add(1, Ordering::SeqCst);
                Ok(CallToolResult::success(vec![Content::text(format!(
                    "{output}:{name}"
                ))]))
            }),
            notifications: Box::pin(futures::stream::empty()),
        })
    }
}

#[tokio::test]
async fn captured_step_keeps_old_route_after_registry_replace() {
    let registry = McpConnectionRegistry::new();
    register(&registry, vec!["search"], "old").await;
    let captured = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;

    registry.remove("docs").await;
    register(&registry, vec!["search", "new_tool"], "new").await;

    let old_result = captured
        .dispatch(call("docs__search"), scope(), CancellationToken::default())
        .await
        .expect("dispatch captured route")
        .response
        .await
        .expect("old result");
    let fresh = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    let new_result = fresh
        .dispatch(call("docs__search"), scope(), CancellationToken::default())
        .await
        .expect("dispatch fresh route")
        .response
        .await
        .expect("new result");

    assert!(fresh.generation() > captured.generation());
    assert!(result_text(&old_result).contains("old:search"));
    assert!(result_text(&new_result).contains("new:search"));
}

#[tokio::test]
async fn snapshot_generation_is_stable_and_monotonic_across_registry_mutations() {
    let registry = McpConnectionRegistry::new();
    let empty = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    assert_eq!(empty.generation(), 0);

    register(&registry, vec!["search"], "first").await;
    let first = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    assert!(first.generation() > empty.generation());
    let first_generation = first.generation();

    registry.remove("docs").await;
    let removed = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    assert!(removed.generation() > first_generation);
    assert_eq!(first.generation(), first_generation);
}

#[tokio::test]
async fn without_server_filters_tool_definitions_and_dispatch_routes() {
    let registry = McpConnectionRegistry::new();
    register_named(&registry, "lime_apps", DiscoveryMode::Ready).await;
    register_named(&registry, "docs", DiscoveryMode::Ready).await;
    let captured = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;

    let filtered = captured.without_server("lime_apps");

    assert!(filtered
        .tools()
        .iter()
        .any(|tool| tool.name == "docs__search"));
    assert!(!filtered
        .tools()
        .iter()
        .any(|tool| tool.name == "lime_apps__search"));
    assert!(filtered
        .dispatch(
            call("lime_apps__search"),
            scope(),
            CancellationToken::default(),
        )
        .await
        .is_err());
    assert!(filtered
        .dispatch(call("docs__search"), scope(), CancellationToken::default(),)
        .await
        .is_ok());
}

#[tokio::test]
async fn snapshot_keeps_server_route_metadata_immutable() {
    let registry = McpConnectionRegistry::new();
    let config = RuntimeExtensionConfig::new(
        "docs",
        "Docs tools",
        vec!["search".to_string()],
        false,
        vec!["search".to_string()],
        None,
    );
    let connection: McpConnectionHandle = Arc::new(Mutex::new(Box::new(TestConnection {
        tools: vec![tool("search", None)],
        output: "docs".to_string(),
        discovery_mode: DiscoveryMode::Ready,
        call_count: Arc::new(AtomicUsize::new(0)),
        observed_scope: None,
    })));
    registry
        .register(
            "docs".to_string(),
            config.clone(),
            McpConnectionProvenance::new("remote-tools", None),
            true,
            Arc::clone(&connection),
        )
        .await;

    let parallel = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    registry.remove("docs").await;
    registry
        .register(
            "docs".to_string(),
            config,
            McpConnectionProvenance::default(),
            false,
            connection,
        )
        .await;
    let serial = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;

    assert!(parallel.supports_parallel_tool_calls("docs__search"));
    assert!(!serial.supports_parallel_tool_calls("docs__search"));
    assert!(parallel.supports_parallel_tool_calls("docs__search"));
    assert!(!parallel.supports_parallel_tool_calls("missing"));
    assert_eq!(
        parallel.environment_id("docs__search"),
        Some("remote-tools")
    );
    assert_eq!(serial.environment_id("docs__search"), Some("local"));
    assert_eq!(
        parallel.environment_id("docs__search"),
        Some("remote-tools")
    );
    assert_eq!(parallel.environment_id("missing"), None);
    assert_eq!(
        parallel.route_identity("docs__search"),
        Some(McpStepRouteIdentity {
            server_name: "docs".to_string(),
            tool_name: "search".to_string(),
            runtime_tool_name: "docs__search".to_string(),
            app_context: None,
            mcp_app_resource_uri: None,
            plugin_id: None,
        })
    );
    assert_eq!(parallel.route_identity("missing"), None);
}

#[tokio::test]
async fn snapshot_freezes_plugin_identity_and_mcp_app_resource_uri() {
    let registry = McpConnectionRegistry::new();
    let config = RuntimeExtensionConfig::new(
        "mcp__plugin__docs__demo",
        "Plugin docs tools",
        vec!["search".to_string()],
        false,
        vec!["search".to_string()],
        None,
    );
    let mut app_tool = tool("search", None);
    app_tool.meta = Some(Meta(
        serde_json::json!({
            "ui": { "resourceUri": "ui://plugin/docs.html" },
            "ui/resourceUri": "ui://plugin/flat.html",
            "openai/outputTemplate": "ui://plugin/fallback.html"
        })
        .as_object()
        .expect("tool meta object")
        .clone(),
    ));
    let connection: McpConnectionHandle = Arc::new(Mutex::new(Box::new(TestConnection {
        tools: vec![app_tool],
        output: "docs".to_string(),
        discovery_mode: DiscoveryMode::Ready,
        call_count: Arc::new(AtomicUsize::new(0)),
        observed_scope: None,
    })));
    registry
        .register(
            "mcp__plugin__docs__demo".to_string(),
            config,
            McpConnectionProvenance::default()
                .with_server_name(Some("plugin__docs__demo".to_string()))
                .with_plugin_id(Some("docs-plugin".to_string())),
            false,
            connection,
        )
        .await;

    let captured = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    registry.remove("mcp__plugin__docs__demo").await;

    assert_eq!(
        captured.route_identity("mcp__plugin__docs__demo__search"),
        Some(McpStepRouteIdentity {
            server_name: "plugin__docs__demo".to_string(),
            tool_name: "search".to_string(),
            runtime_tool_name: "mcp__plugin__docs__demo__search".to_string(),
            app_context: None,
            mcp_app_resource_uri: Some("ui://plugin/docs.html".to_string()),
            plugin_id: Some("docs-plugin".to_string()),
        })
    );
}

#[tokio::test]
async fn read_only_tool_annotation_allows_parallel_execution_without_server_opt_in() {
    let registry = McpConnectionRegistry::new();
    let config = RuntimeExtensionConfig::new(
        "docs",
        "Docs tools",
        vec!["readonly".to_string(), "mutating".to_string()],
        false,
        vec!["readonly".to_string(), "mutating".to_string()],
        None,
    );
    let mut readonly = tool("readonly", None);
    readonly.annotations = Some(ToolAnnotations {
        read_only_hint: Some(true),
        ..ToolAnnotations::default()
    });
    let mut mutating = tool("mutating", None);
    mutating.annotations = Some(ToolAnnotations {
        read_only_hint: Some(false),
        ..ToolAnnotations::default()
    });
    register_connection(
        &registry,
        "docs",
        config,
        vec![readonly, mutating],
        "docs",
        DiscoveryMode::Ready,
        Arc::new(AtomicUsize::new(0)),
    )
    .await;

    let snapshot = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    assert!(snapshot.supports_parallel_tool_calls("docs__readonly"));
    assert!(!snapshot.supports_parallel_tool_calls("docs__mutating"));
}

#[tokio::test]
async fn missing_read_only_tool_annotation_keeps_serial_default() {
    let registry = McpConnectionRegistry::new();
    register(&registry, vec!["search"], "docs").await;

    let snapshot = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    assert!(!snapshot.supports_parallel_tool_calls("docs__search"));
}

#[tokio::test]
async fn dispatch_binds_snapshot_generation_to_call_scope() {
    let registry = McpConnectionRegistry::new();
    let observed_scope = Arc::new(Mutex::new(None));
    let config = RuntimeExtensionConfig::new(
        "docs",
        "Docs tools",
        vec!["search".to_string()],
        false,
        vec!["search".to_string()],
        None,
    );
    let connection: McpConnectionHandle = Arc::new(Mutex::new(Box::new(TestConnection {
        tools: vec![tool("search", None)],
        output: "docs".to_string(),
        discovery_mode: DiscoveryMode::Ready,
        call_count: Arc::new(AtomicUsize::new(0)),
        observed_scope: Some(Arc::clone(&observed_scope)),
    })));
    registry
        .register(
            "docs".to_string(),
            config,
            McpConnectionProvenance::new("local", Some(vec!["search.read".to_string()])),
            false,
            connection,
        )
        .await;

    let snapshot = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    let generation = snapshot.generation();
    snapshot
        .dispatch(call("docs__search"), scope(), CancellationToken::default())
        .await
        .expect("dispatch route")
        .response
        .await
        .expect("call result");

    assert_eq!(
        observed_scope
            .lock()
            .await
            .as_ref()
            .and_then(McpCallScope::snapshot_generation),
        Some(generation)
    );
    assert_eq!(
        observed_scope
            .lock()
            .await
            .as_ref()
            .and_then(McpCallScope::auth_scopes),
        Some(["search.read".to_string()].as_slice())
    );
    assert_eq!(
        observed_scope
            .lock()
            .await
            .as_ref()
            .and_then(McpCallScope::environment_id),
        Some("local")
    );
}

#[tokio::test]
async fn tools_added_after_capture_are_visible_only_to_next_step() {
    let registry = McpConnectionRegistry::new();
    register(&registry, vec!["search"], "old").await;
    let captured = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;

    registry.remove("docs").await;
    register(&registry, vec!["search", "new_tool"], "new").await;
    let fresh = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;

    assert!(!captured
        .tools()
        .iter()
        .any(|tool| tool.name == "docs__new_tool"));
    assert!(captured
        .dispatch(
            call("docs__new_tool"),
            scope(),
            CancellationToken::default(),
        )
        .await
        .is_err());
    assert!(fresh
        .tools()
        .iter()
        .any(|tool| tool.name == "docs__new_tool"));
    assert!(fresh
        .dispatch(
            call("docs__new_tool"),
            scope(),
            CancellationToken::default(),
        )
        .await
        .is_ok());
}

#[tokio::test]
async fn deferred_selection_changes_only_the_next_snapshot() {
    let registry = McpConnectionRegistry::new();
    let config = RuntimeExtensionConfig::new(
        "docs",
        "Docs tools",
        vec!["search".to_string(), "query".to_string()],
        true,
        vec!["search".to_string()],
        None,
    );
    register_connection(
        &registry,
        "docs",
        config,
        vec![tool("search", None), tool("query", None)],
        "docs",
        DiscoveryMode::Ready,
        Arc::new(AtomicUsize::new(0)),
    )
    .await;

    let before = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    let selected = HashSet::from(["docs__query".to_string()]);
    let after = snapshot(&registry, selected, Duration::from_secs(1)).await;

    assert!(before
        .tools()
        .iter()
        .any(|tool| tool.name == "docs__search"));
    assert!(!before.tools().iter().any(|tool| tool.name == "docs__query"));
    assert!(before
        .dispatch(call("docs__query"), scope(), CancellationToken::default())
        .await
        .is_err());
    assert!(after.tools().iter().any(|tool| tool.name == "docs__query"));
    assert!(after
        .dispatch(call("docs__query"), scope(), CancellationToken::default())
        .await
        .is_ok());
}

#[tokio::test]
async fn assistant_snapshot_filters_and_rechecks_per_tool_caller_policy() {
    let registry = McpConnectionRegistry::new();
    let call_count = Arc::new(AtomicUsize::new(0));
    let config = RuntimeExtensionConfig::new(
        "mixed",
        "Mixed caller tools",
        vec![
            "public".to_string(),
            "review".to_string(),
            "execute".to_string(),
        ],
        false,
        Vec::new(),
        None,
    );
    let connection = register_connection(
        &registry,
        "mixed",
        config,
        vec![
            tool("public", None),
            tool("review", Some(&["assistant"])),
            tool("execute", Some(&["code_execution"])),
        ],
        "mixed",
        DiscoveryMode::Ready,
        call_count.clone(),
    )
    .await;

    let captured = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    let names = captured
        .tools()
        .iter()
        .map(|tool| tool.name.as_ref())
        .collect::<Vec<_>>();
    assert_eq!(names, vec!["mixed__public", "mixed__review"]);
    assert!(captured
        .dispatch(
            call("mixed__execute"),
            scope(),
            CancellationToken::default(),
        )
        .await
        .is_err());
    assert_eq!(call_count.load(Ordering::SeqCst), 0);

    let denied_route = McpStepRoute {
        server_name: "mixed".to_string(),
        tool_name: "execute".to_string(),
        app_context: None,
        mcp_app_resource_uri: None,
        allowed_callers: Some(vec!["code_execution".to_string()]),
        provenance: McpConnectionProvenance::default(),
        supports_parallel_tool_calls: false,
        connection,
    };
    let forged_snapshot = McpStepSnapshot {
        caller: RuntimeToolCaller::assistant(),
        generation: 0,
        tools: Arc::new(Vec::new()),
        routes: Arc::new(HashMap::from([(
            "mixed__execute".to_string(),
            denied_route,
        )])),
    };
    assert!(forged_snapshot
        .dispatch(
            call("mixed__execute"),
            scope(),
            CancellationToken::default(),
        )
        .await
        .is_err());
    assert_eq!(call_count.load(Ordering::SeqCst), 0);

    let code_execution = snapshot_for_caller(
        &registry,
        RuntimeToolCaller::parse("code_execution").expect("code execution caller"),
        HashSet::new(),
        Duration::from_secs(1),
    )
    .await;
    let code_names = code_execution
        .tools()
        .iter()
        .map(|tool| tool.name.as_ref())
        .collect::<Vec<_>>();
    assert_eq!(code_names, vec!["mixed__execute", "mixed__public"]);
    let code_result = code_execution
        .dispatch(
            call("mixed__execute"),
            scope(),
            CancellationToken::default(),
        )
        .await
        .expect("code execution route")
        .response
        .await
        .expect("code execution result");
    assert!(result_text(&code_result).contains("mixed:execute"));
    assert_eq!(call_count.load(Ordering::SeqCst), 1);
}

#[test]
fn lime_apps_route_context_comes_from_trusted_tool_metadata() {
    let mut tool = tool("calendar_search", None);
    tool.meta = Some(Meta(
        serde_json::json!({
            "connector_id": "calendar",
            "connector_name": "Calendar",
            "link_id": "link-calendar",
            "ui": { "resourceUri": "ui://calendar/event" },
            "_lime_apps": {
                "resource_uri": "/calendar/link-calendar/calendar_search"
            }
        })
        .as_object()
        .expect("tool metadata")
        .clone(),
    ));

    assert_eq!(
        mcp_app_context("lime_apps", &tool, mcp_app_resource_uri(&tool),),
        Some(McpStepRouteAppContext {
            connector_id: "calendar".to_string(),
            link_id: Some("link-calendar".to_string()),
            resource_uri: Some("ui://calendar/event".to_string()),
            app_name: Some("Calendar".to_string()),
            action_name: Some("calendar_search".to_string()),
        })
    );
    assert_eq!(mcp_app_context("docs", &tool, None), None);
}

#[tokio::test]
async fn per_tool_caller_schema_precedes_extension_fallback() {
    let registry = McpConnectionRegistry::new();
    let config = RuntimeExtensionConfig::new(
        "precedence",
        "Caller precedence",
        vec!["review".to_string()],
        false,
        Vec::new(),
        Some("code_execution".to_string()),
    );
    register_connection(
        &registry,
        "precedence",
        config,
        vec![tool("review", Some(&["assistant"]))],
        "precedence",
        DiscoveryMode::Ready,
        Arc::new(AtomicUsize::new(0)),
    )
    .await;

    let assistant = snapshot(&registry, HashSet::new(), Duration::from_secs(1)).await;
    assert!(assistant
        .tools()
        .iter()
        .any(|tool| tool.name == "precedence__review"));

    let code_execution = snapshot_for_caller(
        &registry,
        RuntimeToolCaller::parse("code_execution").expect("code execution caller"),
        HashSet::new(),
        Duration::from_secs(1),
    )
    .await;
    assert!(code_execution.tools().is_empty());
}

#[tokio::test]
async fn discovery_error_keeps_healthy_server_tools() {
    let registry = McpConnectionRegistry::new();
    register_named(&registry, "fast", DiscoveryMode::Ready).await;
    register_named(&registry, "broken", DiscoveryMode::Error).await;

    let captured = snapshot(&registry, HashSet::new(), Duration::from_millis(50)).await;

    assert!(captured
        .tools()
        .iter()
        .any(|tool| tool.name == "fast__search"));
    assert!(!captured
        .tools()
        .iter()
        .any(|tool| tool.name == "broken__search"));
    assert!(captured
        .dispatch(call("fast__search"), scope(), CancellationToken::default())
        .await
        .is_ok());
}

#[tokio::test]
async fn discovery_timeout_keeps_concurrent_healthy_server_tools() {
    let registry = McpConnectionRegistry::new();
    register_named(&registry, "slow", DiscoveryMode::Slow).await;
    register_named(&registry, "fast", DiscoveryMode::Ready).await;

    let captured = tokio::time::timeout(
        Duration::from_millis(200),
        snapshot(&registry, HashSet::new(), Duration::from_millis(10)),
    )
    .await
    .expect("per-server timeout should keep snapshot capture bounded");

    assert!(captured
        .tools()
        .iter()
        .any(|tool| tool.name == "fast__search"));
    assert!(!captured
        .tools()
        .iter()
        .any(|tool| tool.name == "slow__search"));
    assert_eq!(registry.names().await, vec!["fast", "slow"]);
}
