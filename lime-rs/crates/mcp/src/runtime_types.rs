//! Read-only MCP runtime metadata shared with extension owners.
//!
//! The executable connection manager remains Lime's core-only manager. These
//! types expose the exact registration/tool identity needed by extensions
//! without leaking a second executable client.

use std::collections::HashMap;
use std::sync::Arc;

use rmcp::model::Tool;
use serde::Deserialize;
use serde::Serialize;

use crate::McpCatalog;
use crate::McpServerConfig;
use crate::McpServerKey;

/// Read-only MCP configuration surface exposed to extension contributors.
#[derive(Clone, Debug, Default)]
pub struct McpConfig {
    pub mcp_server_catalog: McpCatalog,
}

impl McpConfig {
    pub fn new(catalog: McpCatalog) -> Self {
        Self {
            mcp_server_catalog: catalog,
        }
    }
}

/// Metadata for one MCP tool registration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolInfo {
    #[serde(flatten)]
    pub server_key: McpServerKey,
    #[serde(default)]
    pub supports_parallel_tool_calls: bool,
    #[serde(default)]
    pub server_origin: Option<String>,
    #[serde(rename = "tool_name", alias = "callable_name")]
    pub callable_name: String,
    #[serde(rename = "tool_namespace", alias = "callable_namespace")]
    pub callable_namespace: String,
    #[serde(default, alias = "connector_description")]
    pub namespace_description: Option<String>,
    pub tool: Tool,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub openai_file_input_optional_fields: HashMap<String, Vec<String>>,
    pub connector_id: Option<String>,
    pub connector_name: Option<String>,
    #[serde(default)]
    pub plugin_display_names: Vec<String>,
}

impl ToolInfo {
    pub fn server_key(&self) -> &McpServerKey {
        &self.server_key
    }

    pub fn server_name(&self) -> &str {
        self.server_key.name()
    }
}

/// Frozen metadata for one prepared MCP call.
#[derive(Clone, Debug)]
pub struct PreparedMcpCall {
    config: Arc<McpConfig>,
    tool_info: ToolInfo,
    plugin_id: Option<String>,
    selected_plugin_server: bool,
    host_owned_apps: bool,
}

impl PreparedMcpCall {
    pub fn new(
        config: Arc<McpConfig>,
        tool_info: ToolInfo,
        plugin_id: Option<String>,
        selected_plugin_server: bool,
        host_owned_apps: bool,
    ) -> Self {
        Self {
            config,
            tool_info,
            plugin_id,
            selected_plugin_server,
            host_owned_apps,
        }
    }

    pub fn config(&self) -> &McpConfig {
        &self.config
    }

    pub fn tool_info(&self) -> &ToolInfo {
        &self.tool_info
    }

    pub fn server_key(&self) -> &McpServerKey {
        self.tool_info.server_key()
    }

    pub fn plugin_id(&self) -> Option<&str> {
        self.plugin_id.as_deref()
    }

    pub fn is_selected_plugin_server(&self) -> bool {
        self.selected_plugin_server
    }

    pub fn is_host_owned_apps(&self) -> bool {
        self.host_owned_apps
    }
}

/// Opaque resource-client cache key for extension-owned backoff.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct McpResourceClientAuthKey;

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct McpResourceServerCacheKey;

/// Read-only resource client handle exposed to extension thread lifecycle.
#[derive(Clone, Debug, Default)]
pub struct McpResourceClient;

impl McpResourceClient {
    pub fn from_config(_config: &McpServerConfig) -> Self {
        Self
    }
}
