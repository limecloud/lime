use crate::client::McpClientWrapper;
use crate::types::{McpServerConfig, McpServerTransport, McpToolDefinition};
use std::collections::HashMap;

/// 创建测试用的服务器配置
pub(super) fn create_test_config() -> McpServerConfig {
    McpServerConfig {
        transport: McpServerTransport::Stdio {
            env_vars: Vec::new(),
            command: "test-command".to_string(),
            args: vec!["--arg1".to_string(), "--arg2".to_string()],
            env: Some(HashMap::new()),
            cwd: None,
        },
        environment_id: crate::types::DEFAULT_MCP_SERVER_ENVIRONMENT_ID.to_string(),
        enabled: true,
        startup_timeout_sec: Some(std::time::Duration::from_secs(30)),
        tool_timeout_sec: None,
        enabled_tools: None,
        disabled_tools: None,
        required: false,
        supports_parallel_tool_calls: false,
        scopes: None,
        oauth: None,
        oauth_resource: None,
        ..Default::default()
    }
}

pub(super) fn create_test_config_with_command(command: &str, timeout: u64) -> McpServerConfig {
    McpServerConfig {
        transport: McpServerTransport::Stdio {
            env_vars: Vec::new(),
            command: command.to_string(),
            args: Vec::new(),
            env: Some(HashMap::new()),
            cwd: None,
        },
        environment_id: crate::types::DEFAULT_MCP_SERVER_ENVIRONMENT_ID.to_string(),
        enabled: true,
        startup_timeout_sec: Some(std::time::Duration::from_secs(timeout)),
        tool_timeout_sec: None,
        enabled_tools: None,
        disabled_tools: None,
        required: false,
        supports_parallel_tool_calls: false,
        scopes: None,
        oauth: None,
        oauth_resource: None,
        ..Default::default()
    }
}

/// 创建测试用的客户端包装器
pub(super) fn create_test_client(name: &str) -> McpClientWrapper {
    McpClientWrapper::new(name.to_string(), create_test_config(), None)
}

pub(super) fn create_test_tool(
    name: &str,
    description: &str,
    server_name: &str,
) -> McpToolDefinition {
    McpToolDefinition {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: serde_json::json!({}),
        output_schema: None,
        server_name: server_name.to_string(),
        deferred_loading: None,
        always_visible: None,
        allowed_callers: None,
        input_examples: None,
        tags: None,
    }
}
