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
            env: HashMap::new(),
            cwd: None,
        },
        environment_id: crate::types::DEFAULT_MCP_SERVER_ENVIRONMENT_ID.to_string(),
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

pub(super) fn create_test_config_with_command(command: &str, timeout: u64) -> McpServerConfig {
    McpServerConfig {
        transport: McpServerTransport::Stdio {
            env_vars: Vec::new(),
            command: command.to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: None,
        },
        environment_id: crate::types::DEFAULT_MCP_SERVER_ENVIRONMENT_ID.to_string(),
        enabled: true,
        startup_timeout: timeout,
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
