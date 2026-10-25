use crate::types::{McpServerConfig, DEFAULT_MCP_SERVER_ENVIRONMENT_ID};
use std::collections::HashMap;

/// MCP 服务器环境的运行时注册表。
///
/// 当前只有本机执行器。远程执行器接入前，显式引用未知环境必须拒绝，
/// 不能把配置身份降级成本机进程。
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct McpEnvironmentRegistry {
    available: HashMap<String, McpEnvironment>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum McpEnvironment {
    Local,
}

impl Default for McpEnvironmentRegistry {
    fn default() -> Self {
        Self::local()
    }
}

impl McpEnvironmentRegistry {
    pub(crate) fn local() -> Self {
        Self {
            available: HashMap::from([(
                DEFAULT_MCP_SERVER_ENVIRONMENT_ID.to_string(),
                McpEnvironment::Local,
            )]),
        }
    }

    pub(crate) fn resolve_server_environment(
        &self,
        server_name: &str,
        config: &McpServerConfig,
    ) -> Result<McpEnvironment, String> {
        let environment_id = config.environment_id.trim();
        if environment_id.is_empty() {
            return Err(format!(
                "MCP server `{server_name}` requires a non-empty environment id"
            ));
        }
        if let Some(environment) = self.available.get(environment_id) {
            return Ok(*environment);
        }
        Err(format!(
            "MCP server `{server_name}` references unknown environment id `{environment_id}`"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{McpEnvironment, McpEnvironmentRegistry};
    use crate::types::{McpServerConfig, McpServerTransport};
    use std::collections::HashMap;

    #[test]
    fn registry_resolves_local_to_typed_placement() {
        let registry = McpEnvironmentRegistry::local();
        let config = McpServerConfig {
            transport: McpServerTransport::Stdio {
                env_vars: Vec::new(),
                command: "server".to_string(),
                args: Vec::new(),
                env: HashMap::new(),
                cwd: None,
            },
            environment_id: "local".to_string(),
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
        };

        assert_eq!(
            registry
                .resolve_server_environment("server", &config)
                .expect("local environment"),
            McpEnvironment::Local
        );
    }
}
