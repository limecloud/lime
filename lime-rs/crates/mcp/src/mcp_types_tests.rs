use super::{McpServerConfig, McpServerTransport, DEFAULT_MCP_SERVER_ENVIRONMENT_ID};
use std::collections::HashMap;
use std::path::PathBuf;

fn sample_config(cwd: Option<String>) -> McpServerConfig {
    McpServerConfig {
        transport: McpServerTransport::Stdio {
            env_vars: Vec::new(),
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "some-server".to_string()],
            env: HashMap::new(),
            cwd,
        },
        environment_id: DEFAULT_MCP_SERVER_ENVIRONMENT_ID.to_string(),
        enabled: true,
        startup_timeout: 30,
        tool_timeout: None,
        enabled_tools: None,
        disabled_tools: Vec::new(),
        required: false,
        supports_parallel_tool_calls: false,
        scopes: None,
        oauth: None,
        oauth_resource: None,
    }
}

#[test]
fn sanitized_cwd_should_strip_nul_suffix() {
    let config = sample_config(Some(" /tmp/demo\0ignored ".to_string()));
    assert_eq!(config.sanitized_cwd(), Some(PathBuf::from("/tmp/demo")));
}

#[test]
fn sanitized_cwd_should_reject_empty_value() {
    let config = sample_config(Some(" \0 ".to_string()));
    assert!(config.sanitized_cwd().is_none());
}

#[test]
fn parses_legacy_stdio_config() {
    let config = McpServerConfig::from_value(serde_json::json!({
        "command": "node",
        "args": ["server.js"],
        "env": { "A": "1" },
        "cwd": "~/project",
        "timeout": 42
    }))
    .unwrap();

    assert_eq!(config.transport_kind(), "stdio");
    assert_eq!(config.command(), "node");
    assert_eq!(config.args(), &["server.js".to_string()]);
    assert_eq!(config.startup_timeout, 42);
    assert_eq!(config.environment_id, DEFAULT_MCP_SERVER_ENVIRONMENT_ID);
}

#[test]
fn parses_explicit_environment_identity_without_deriving_from_cwd() {
    let config = McpServerConfig::from_value(serde_json::json!({
        "command": "node",
        "cwd": "/tmp/other",
        "environmentId": "remote"
    }))
    .unwrap();

    assert_eq!(config.environment_id, "remote");
}

#[test]
fn rejects_empty_environment_identity() {
    let error = McpServerConfig::from_value(serde_json::json!({
        "command": "node",
        "environment_id": "  "
    }))
    .unwrap_err();

    assert!(error.contains("environment_id"));
}

#[test]
fn parses_streamable_http_config() {
    let config = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "bearer_token_env_var": "MCP_TOKEN",
        "tool_timeout_sec": 12,
        "enabled_tools": ["search"],
        "disabled_tools": ["delete"]
    }))
    .unwrap();

    assert_eq!(config.transport_kind(), "streamable_http");
    assert_eq!(config.tool_timeout_secs(), 12);
    assert!(config.tool_is_enabled("search"));
    assert!(!config.tool_is_enabled("delete"));
    assert!(!config.tool_is_enabled("other"));
}

#[test]
fn parses_streamable_http_oauth_shape_but_runtime_validation_fails_closed() {
    let config = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "scopes": ["search.read"],
        "oauth": { "clientId": "lime-client" },
        "oauthResource": "https://example.com"
    }))
    .unwrap();

    assert_eq!(
        config.scopes.as_deref(),
        Some(&["search.read".to_string()][..])
    );
    assert_eq!(
        config
            .oauth
            .as_ref()
            .and_then(|oauth| oauth.client_id.as_deref()),
        Some("lime-client")
    );
    assert_eq!(
        config.oauth_resource.as_deref(),
        Some("https://example.com")
    );

    let error = config.validate().unwrap_err();
    assert!(error.contains("client_id/oauth_resource"));

    let auth_status = config.auth_status();
    assert_eq!(auth_status.mode, "oauth");
    assert!(!auth_status.available);
    assert_eq!(
        auth_status.reason_code.as_deref(),
        Some("oauth_runtime_not_implemented")
    );
}

#[test]
fn parses_dynamic_streamable_http_oauth_shape_and_validation_allows_login() {
    let config = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "scopes": ["search.read"]
    }))
    .unwrap();

    assert!(config.validate().is_ok());
    let auth_status = config.auth_status();
    assert_eq!(auth_status.mode, "oauth");
    assert!(auth_status.available);
    assert_eq!(
        auth_status.reason_code.as_deref(),
        Some("oauth_login_required")
    );
    let plan = auth_status.action_plan.expect("oauth should expose plan");
    assert_eq!(plan.kind, "oauth_login");
    assert_eq!(plan.state, "login_required");
    assert_eq!(
        plan.required_runtime.as_deref(),
        Some("mcp_server_oauth_login")
    );
}

#[test]
fn rejects_oauth_shape_on_stdio_transport() {
    let error = McpServerConfig::from_value(serde_json::json!({
        "transport": "stdio",
        "command": "node",
        "oauth": { "client_id": "lime-client" }
    }))
    .unwrap_err();

    assert!(error.contains("only supported for streamable_http"));
}

#[test]
fn rejects_inline_bearer_token() {
    let error = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "bearer_token": "secret"
    }))
    .unwrap_err();

    assert!(error.contains("bearer_token_env_var"));
}

#[test]
fn rejects_invalid_oauth_shapes() {
    let scopes_error = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "scopes": ["ok", 1]
    }))
    .unwrap_err();
    assert!(scopes_error.contains("scopes"));

    let client_error = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "oauth": { "client_id": 1 }
    }))
    .unwrap_err();
    assert!(client_error.contains("client_id"));

    let resource_error = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "oauth_resource": 1
    }))
    .unwrap_err();
    assert!(resource_error.contains("oauth_resource"));
}

#[test]
fn reports_static_header_auth_status_for_streamable_http_secrets() {
    let config = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "bearer_token_env_var": "MCP_TOKEN"
    }))
    .unwrap();

    let auth_status = config.auth_status();
    assert_eq!(auth_status.mode, "static_headers");
    assert!(auth_status.available);
    assert!(auth_status.reason_code.is_none());
}

#[test]
fn reports_none_auth_status_for_unauthenticated_servers() {
    let config = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "https://example.com/mcp"
    }))
    .unwrap();

    let auth_status = config.auth_status();
    assert_eq!(auth_status.mode, "none");
    assert!(auth_status.available);
    assert!(auth_status.reason_code.is_none());
}

#[test]
fn parses_streamable_http_headers_in_snake_and_camel_case() {
    let snake = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "http_headers": { "X-Foo": "bar" },
        "env_http_headers": { "X-Token": "MCP_TOKEN" }
    }))
    .unwrap();
    let McpServerTransport::StreamableHttp {
        http_headers,
        env_http_headers,
        ..
    } = snake.transport
    else {
        panic!("expected streamable_http transport");
    };
    assert_eq!(http_headers.unwrap().get("X-Foo").unwrap(), "bar");
    assert_eq!(
        env_http_headers.unwrap().get("X-Token").unwrap(),
        "MCP_TOKEN"
    );

    let camel = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable-http",
        "url": "https://example.com/mcp",
        "httpHeaders": { "X-Foo": "bar" },
        "envHttpHeaders": { "X-Token": "MCP_TOKEN" }
    }))
    .unwrap();
    let McpServerTransport::StreamableHttp {
        http_headers,
        env_http_headers,
        ..
    } = camel.transport
    else {
        panic!("expected streamable_http transport");
    };
    assert_eq!(http_headers.unwrap().get("X-Foo").unwrap(), "bar");
    assert_eq!(
        env_http_headers.unwrap().get("X-Token").unwrap(),
        "MCP_TOKEN"
    );
}

#[test]
fn validates_streamable_http_url() {
    let error = McpServerConfig::from_value(serde_json::json!({
        "transport": "streamable_http",
        "url": "file:///tmp/mcp"
    }))
    .unwrap_err();

    assert!(error.contains("http:// or https://"));
}

#[test]
fn stdio_passthrough_round_trips_and_rejects_remote_or_malformed_names() {
    let config: McpServerConfig = serde_json::from_value(serde_json::json!({
        "command": "node", "env_vars": ["TOKEN", "WORKSPACE"],
        "env": {"TOKEN": " explicit "}
    }))
    .unwrap();
    assert_eq!(config.env_vars(), ["TOKEN", "WORKSPACE"]);
    assert_eq!(
        serde_json::to_value(&config).unwrap()["env_vars"],
        serde_json::json!(["TOKEN", "WORKSPACE"])
    );
    config.validate().unwrap();
    for value in [
        serde_json::json!([{"name":"TOKEN", "source":"remote"}]),
        serde_json::json!("TOKEN"),
        serde_json::json!([1]),
    ] {
        assert!(serde_json::from_value::<McpServerConfig>(
            serde_json::json!({"command":"node", "env_vars":value})
        )
        .is_err());
    }
    for name in ["", "A=B", "A\0B"] {
        assert!(serde_json::from_value::<McpServerConfig>(
            serde_json::json!({"command":"node", "env_vars":[name]})
        )
        .is_err());
    }
}
