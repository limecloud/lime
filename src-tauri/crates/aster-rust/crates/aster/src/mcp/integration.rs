//! MCP Integration Module
//!
//! This module provides integration between the new MCP components
//! (ConnectionManager, LifecycleManager, ConfigManager, ToolManager)
//! and the existing ExtensionManager and tool registry systems.
//!
//! # Features
//!
//! - Unified interface for MCP operations through ExtensionManager
//! - Tool registry integration for exposing MCP tools
//! - Permission system integration for MCP tool calls
//!
//! # Requirements Coverage
//!
//! - 7.1: McpConnectionManager usable from ExtensionManager
//! - 7.2: Use McpLifecycleManager to start servers when extension enabled
//! - 7.3: Use McpLifecycleManager to stop servers when extension disabled
//! - 7.4: Expose MCP tools through existing tool registry
//! - 7.5: Apply existing permission rules to MCP tool calls

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::mcp::config_manager::McpConfigManager;
use crate::mcp::connection_manager::{ConnectionManager, McpConnectionManager};
use crate::mcp::error::{McpError, McpResult};
use crate::mcp::lifecycle_manager::{
    LifecycleManager, McpLifecycleManager, StartOptions, StopOptions,
};
use crate::mcp::tool_manager::{McpTool, McpToolManager, ToolCallResult, ToolManager};
use crate::mcp::types::{JsonObject, McpServerConfig, McpServerInfo};
use crate::permission::{PermissionContext, PermissionResult, ToolPermissionManager};
use crate::tools::{McpToolWrapper, Tool};

/// MCP Integration Manager
///
/// Provides a unified interface for integrating MCP components with
/// the existing ExtensionManager and tool registry systems.
///
/// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
pub struct McpIntegration<C: ConnectionManager + 'static> {
    /// Connection manager for MCP server connections
    connection_manager: Arc<C>,
    /// Lifecycle manager for server process management
    lifecycle_manager: Arc<McpLifecycleManager>,
    /// Config manager for server configurations
    config_manager: Arc<McpConfigManager>,
    /// Tool manager for tool discovery and invocation
    tool_manager: Arc<McpToolManager<C>>,
    /// Permission manager for tool permission checks
    permission_manager: Option<Arc<RwLock<ToolPermissionManager>>>,
    /// Server name to extension name mapping
    server_extension_map: Arc<RwLock<HashMap<String, String>>>,
}

impl McpIntegration<McpConnectionManager> {
    /// Create a new MCP integration with default connection manager
    pub fn new() -> Self {
        let connection_manager = Arc::new(McpConnectionManager::new());
        let lifecycle_manager = Arc::new(McpLifecycleManager::new());
        let config_manager = Arc::new(McpConfigManager::new());
        let tool_manager = Arc::new(McpToolManager::new(connection_manager.clone()));

        Self {
            connection_manager,
            lifecycle_manager,
            config_manager,
            tool_manager,
            permission_manager: None,
            server_extension_map: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create a new MCP integration with custom components
    pub fn with_components(
        connection_manager: Arc<McpConnectionManager>,
        lifecycle_manager: Arc<McpLifecycleManager>,
        config_manager: Arc<McpConfigManager>,
    ) -> Self {
        let tool_manager = Arc::new(McpToolManager::new(connection_manager.clone()));

        Self {
            connection_manager,
            lifecycle_manager,
            config_manager,
            tool_manager,
            permission_manager: None,
            server_extension_map: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl Default for McpIntegration<McpConnectionManager> {
    fn default() -> Self {
        Self::new()
    }
}

impl<C: ConnectionManager + 'static> McpIntegration<C> {
    /// Set the permission manager for tool permission checks
    ///
    /// Requirements: 7.5
    pub fn set_permission_manager(&mut self, manager: Arc<RwLock<ToolPermissionManager>>) {
        self.permission_manager = Some(manager);
    }

    /// Get the connection manager
    ///
    /// Requirements: 7.1
    pub fn connection_manager(&self) -> &Arc<C> {
        &self.connection_manager
    }

    /// Get the lifecycle manager
    ///
    /// Requirements: 7.2, 7.3
    pub fn lifecycle_manager(&self) -> &Arc<McpLifecycleManager> {
        &self.lifecycle_manager
    }

    /// Get the config manager
    pub fn config_manager(&self) -> &Arc<McpConfigManager> {
        &self.config_manager
    }

    /// Get the tool manager
    ///
    /// Requirements: 7.4
    pub fn tool_manager(&self) -> &Arc<McpToolManager<C>> {
        &self.tool_manager
    }

    // =========================================================================
    // Extension Integration (Requirements: 7.1, 7.2, 7.3)
    // =========================================================================

    /// Enable an MCP extension (start server and connect)
    ///
    /// This method:
    /// 1. Registers the server with the lifecycle manager
    /// 2. Starts the server process
    /// 3. Establishes a connection via the connection manager
    ///
    /// Requirements: 7.2
    pub async fn enable_extension(
        &self,
        extension_name: &str,
        config: McpServerConfig,
    ) -> McpResult<()> {
        let server_name = extension_name.to_string();

        // Register server with lifecycle manager
        self.lifecycle_manager
            .register_server(&server_name, config.clone());

        // Start the server process
        let start_options = StartOptions {
            wait_for_ready: true,
            ..Default::default()
        };
        self.lifecycle_manager
            .start(&server_name, Some(start_options))
            .await?;

        // Create server info for connection
        let server_info = McpServerInfo::from_config(&server_name, &config);

        // Connect to the server
        self.connection_manager.connect(server_info).await?;

        // Map server name to extension name
        {
            let mut map = self.server_extension_map.write().await;
            map.insert(server_name, extension_name.to_string());
        }

        Ok(())
    }

    /// Disable an MCP extension (disconnect and stop server)
    ///
    /// This method:
    /// 1. Disconnects from the server
    /// 2. Stops the server process
    /// 3. Unregisters the server from the lifecycle manager
    ///
    /// Requirements: 7.3
    pub async fn disable_extension(&self, extension_name: &str) -> McpResult<()> {
        let server_name = extension_name.to_string();

        // Get connection ID for this server
        if let Some(conn) = self
            .connection_manager
            .get_connection_by_server(&server_name)
        {
            // Disconnect from the server
            self.connection_manager.disconnect(&conn.id).await?;
        }

        // Stop the server process
        let stop_options = StopOptions {
            reason: Some("Extension disabled".to_string()),
            ..Default::default()
        };
        self.lifecycle_manager
            .stop(&server_name, Some(stop_options))
            .await?;

        // Unregister from lifecycle manager
        self.lifecycle_manager
            .unregister_server(&server_name)
            .await?;

        // Remove from mapping
        {
            let mut map = self.server_extension_map.write().await;
            map.remove(&server_name);
        }

        // Clear tool cache for this server
        self.tool_manager.clear_cache(Some(&server_name));

        Ok(())
    }

    /// Check if an extension is enabled
    pub async fn is_extension_enabled(&self, extension_name: &str) -> bool {
        self.lifecycle_manager.is_running(extension_name)
    }

    /// Get all enabled extensions
    pub fn get_enabled_extensions(&self) -> Vec<String> {
        self.lifecycle_manager.get_running_servers()
    }

    // =========================================================================
    // Tool Registry Integration (Requirements: 7.4)
    // =========================================================================

    /// List all available MCP tools
    ///
    /// Returns tools from all connected servers, suitable for
    /// registration with the tool registry.
    ///
    /// Requirements: 7.4
    pub async fn list_tools(&self) -> McpResult<Vec<McpTool>> {
        self.tool_manager.list_tools(None).await
    }

    /// List tools from a specific server
    pub async fn list_tools_from_server(&self, server_name: &str) -> McpResult<Vec<McpTool>> {
        self.tool_manager.list_tools(Some(server_name)).await
    }

    /// Get a specific tool
    pub async fn get_tool(&self, server_name: &str, tool_name: &str) -> McpResult<Option<McpTool>> {
        self.tool_manager.get_tool(server_name, tool_name).await
    }

    /// Convert MCP tools to tool registry wrappers
    ///
    /// This method converts MCP tools to McpToolWrapper instances
    /// that can be registered with the ToolRegistry.
    ///
    /// Requirements: 7.4
    pub async fn get_tool_wrappers(&self) -> McpResult<Vec<McpToolWrapper>> {
        let tools = self.list_tools().await?;
        Ok(tools
            .into_iter()
            .map(|tool| {
                McpToolWrapper::new(
                    format!("{}_{}", tool.server_name, tool.name),
                    tool.description.unwrap_or_default(),
                    tool.input_schema,
                    tool.server_name,
                )
            })
            .collect())
    }

    /// Register all MCP tools with a tool registry
    ///
    /// This method discovers all tools from connected MCP servers
    /// and registers them with the provided tool registry.
    ///
    /// Requirements: 7.4
    pub async fn register_tools_with_registry(
        &self,
        registry: &mut crate::tools::ToolRegistry,
    ) -> McpResult<usize> {
        let wrappers = self.get_tool_wrappers().await?;
        let count = wrappers.len();

        for wrapper in wrappers {
            let name = wrapper.name().to_string();
            registry.register_mcp(name, wrapper);
        }

        Ok(count)
    }

    /// Unregister all MCP tools from a tool registry
    ///
    /// This method removes all MCP tools that were previously
    /// registered from the provided tool registry.
    pub fn unregister_tools_from_registry(
        &self,
        registry: &mut crate::tools::ToolRegistry,
        server_name: Option<&str>,
    ) {
        let mcp_tool_names: Vec<String> = registry
            .mcp_tool_names()
            .iter()
            .map(|s| s.to_string())
            .collect();

        for name in mcp_tool_names {
            // If server_name is specified, only remove tools from that server
            if let Some(server) = server_name {
                if name.starts_with(&format!("{}_", server)) {
                    registry.unregister_mcp(&name);
                }
            } else {
                registry.unregister_mcp(&name);
            }
        }
    }

    /// Call an MCP tool with permission checking
    ///
    /// This method:
    /// 1. Checks permissions using the permission manager
    /// 2. Calls the tool if permitted
    /// 3. Returns the result
    ///
    /// Requirements: 7.4, 7.5
    pub async fn call_tool(
        &self,
        server_name: &str,
        tool_name: &str,
        args: JsonObject,
        context: &PermissionContext,
    ) -> McpResult<ToolCallResult> {
        // Check permissions if permission manager is configured
        if let Some(ref perm_manager) = self.permission_manager {
            let full_tool_name = format!("{}_{}", server_name, tool_name);
            let params_map = args.iter().map(|(k, v)| (k.clone(), v.clone())).collect();

            let perm_result =
                perm_manager
                    .read()
                    .await
                    .is_allowed(&full_tool_name, &params_map, context);

            if !perm_result.allowed {
                return Err(McpError::permission_denied(
                    perm_result.reason.unwrap_or_else(|| {
                        format!("Permission denied for tool '{}'", full_tool_name)
                    }),
                ));
            }
        }

        // Call the tool
        self.tool_manager
            .call_tool(server_name, tool_name, args)
            .await
    }

    /// Call an MCP tool without permission checking
    ///
    /// Use this method when permission checking is handled externally.
    pub async fn call_tool_unchecked(
        &self,
        server_name: &str,
        tool_name: &str,
        args: JsonObject,
    ) -> McpResult<ToolCallResult> {
        self.tool_manager
            .call_tool(server_name, tool_name, args)
            .await
    }

    // =========================================================================
    // Permission Integration (Requirements: 7.5)
    // =========================================================================

    /// Check if a tool call is permitted
    ///
    /// This method applies the same permission rules as built-in tools
    /// to MCP tool calls.
    ///
    /// Requirements: 7.5
    pub async fn check_tool_permission(
        &self,
        server_name: &str,
        tool_name: &str,
        args: &JsonObject,
        context: &PermissionContext,
    ) -> PermissionResult {
        if let Some(ref perm_manager) = self.permission_manager {
            // Use the full tool name format: server_toolname
            let full_tool_name = format!("{}_{}", server_name, tool_name);
            let params_map = args.iter().map(|(k, v)| (k.clone(), v.clone())).collect();

            perm_manager
                .read()
                .await
                .is_allowed(&full_tool_name, &params_map, context)
        } else {
            // No permission manager - allow by default
            PermissionResult {
                allowed: true,
                reason: None,
                restricted: false,
                suggestions: Vec::new(),
                matched_rule: None,
                violations: Vec::new(),
            }
        }
    }

    /// Check permissions for multiple tools
    ///
    /// Requirements: 7.5
    pub async fn check_tools_permissions(
        &self,
        tools: &[(String, String, JsonObject)], // (server_name, tool_name, args)
        context: &PermissionContext,
    ) -> Vec<(String, PermissionResult)> {
        let mut results = Vec::new();

        for (server_name, tool_name, args) in tools {
            let full_name = format!("{}_{}", server_name, tool_name);
            let result = self
                .check_tool_permission(server_name, tool_name, args, context)
                .await;
            results.push((full_name, result));
        }

        results
    }

    /// Check if a tool is allowed without arguments
    ///
    /// This is useful for checking if a tool is generally allowed
    /// before attempting to call it.
    ///
    /// Requirements: 7.5
    pub async fn is_tool_allowed(
        &self,
        server_name: &str,
        tool_name: &str,
        context: &PermissionContext,
    ) -> bool {
        let empty_args = serde_json::Map::new();
        let result = self
            .check_tool_permission(server_name, tool_name, &empty_args, context)
            .await;
        result.allowed
    }

    /// Get all denied tools for a context
    ///
    /// Returns a list of tool names that are explicitly denied
    /// for the given context.
    ///
    /// Requirements: 7.5
    pub async fn get_denied_tools(&self, context: &PermissionContext) -> Vec<String> {
        if let Some(ref perm_manager) = self.permission_manager {
            let manager = perm_manager.read().await;
            let permissions = manager.get_permissions(None);

            permissions
                .iter()
                .filter(|p| !p.allowed)
                .filter(|p| {
                    // Check if conditions match the context
                    crate::permission::check_conditions(&p.conditions, context)
                })
                .map(|p| p.tool.clone())
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Filter tools by permission
    ///
    /// Returns only the tools that are allowed for the given context.
    ///
    /// Requirements: 7.5
    pub async fn filter_allowed_tools(
        &self,
        tools: Vec<McpTool>,
        context: &PermissionContext,
    ) -> Vec<McpTool> {
        let mut allowed_tools = Vec::new();

        for tool in tools {
            if self
                .is_tool_allowed(&tool.server_name, &tool.name, context)
                .await
            {
                allowed_tools.push(tool);
            }
        }

        allowed_tools
    }

    /// List only allowed tools from all servers
    ///
    /// This combines tool discovery with permission filtering.
    ///
    /// Requirements: 7.4, 7.5
    pub async fn list_allowed_tools(&self, context: &PermissionContext) -> McpResult<Vec<McpTool>> {
        let all_tools = self.list_tools().await?;
        Ok(self.filter_allowed_tools(all_tools, context).await)
    }
}

/// Helper trait for creating McpServerInfo from config
impl McpServerInfo {
    /// Create server info from a config
    pub fn from_config(name: &str, config: &McpServerConfig) -> Self {
        use crate::mcp::types::ConnectionOptions;

        Self {
            name: name.to_string(),
            transport_type: config.transport_type,
            command: config.command.clone(),
            args: config.args.clone(),
            env: config.env.clone(),
            url: config.url.clone(),
            headers: config.headers.clone(),
            options: ConnectionOptions::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::types::TransportType;

    #[test]
    fn test_mcp_integration_new() {
        let integration = McpIntegration::new();
        assert!(integration.permission_manager.is_none());
    }

    #[test]
    fn test_mcp_integration_set_permission_manager() {
        let mut integration = McpIntegration::new();
        let perm_manager = Arc::new(RwLock::new(ToolPermissionManager::new(None)));
        integration.set_permission_manager(perm_manager);
        assert!(integration.permission_manager.is_some());
    }

    #[test]
    fn test_server_info_from_config() {
        let config = McpServerConfig {
            transport_type: TransportType::Stdio,
            command: Some("echo".to_string()),
            args: Some(vec!["hello".to_string()]),
            enabled: true,
            ..Default::default()
        };

        let info = McpServerInfo::from_config("test_server", &config);
        assert_eq!(info.name, "test_server");
        assert_eq!(info.transport_type, TransportType::Stdio);
        assert_eq!(info.command, Some("echo".to_string()));
    }

    #[tokio::test]
    async fn test_check_tool_permission_no_manager() {
        let integration = McpIntegration::new();
        let context = PermissionContext {
            working_directory: std::path::PathBuf::from("/tmp"),
            session_id: "test".to_string(),
            timestamp: 0,
            user: None,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        };

        let args = serde_json::Map::new();
        let result = integration
            .check_tool_permission("server", "tool", &args, &context)
            .await;

        // Should allow by default when no permission manager
        assert!(result.allowed);
    }

    #[tokio::test]
    async fn test_get_enabled_extensions_empty() {
        let integration = McpIntegration::new();
        let extensions = integration.get_enabled_extensions();
        assert!(extensions.is_empty());
    }

    #[test]
    fn test_mcp_tool_wrapper_creation() {
        use crate::tools::Tool;

        let wrapper = McpToolWrapper::new(
            "server_tool",
            "A test tool",
            serde_json::json!({"type": "object"}),
            "test_server",
        );

        assert_eq!(wrapper.name(), "server_tool");
        assert_eq!(wrapper.description(), "A test tool");
        assert_eq!(wrapper.server_name(), "test_server");
    }

    #[tokio::test]
    async fn test_is_tool_allowed_no_manager() {
        let integration = McpIntegration::new();
        let context = PermissionContext {
            working_directory: std::path::PathBuf::from("/tmp"),
            session_id: "test".to_string(),
            timestamp: 0,
            user: None,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        };

        // Should allow by default when no permission manager
        let allowed = integration
            .is_tool_allowed("server", "tool", &context)
            .await;
        assert!(allowed);
    }

    #[tokio::test]
    async fn test_get_denied_tools_no_manager() {
        let integration = McpIntegration::new();
        let context = PermissionContext {
            working_directory: std::path::PathBuf::from("/tmp"),
            session_id: "test".to_string(),
            timestamp: 0,
            user: None,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        };

        // Should return empty list when no permission manager
        let denied = integration.get_denied_tools(&context).await;
        assert!(denied.is_empty());
    }

    #[tokio::test]
    async fn test_filter_allowed_tools_no_manager() {
        let integration = McpIntegration::new();
        let context = PermissionContext {
            working_directory: std::path::PathBuf::from("/tmp"),
            session_id: "test".to_string(),
            timestamp: 0,
            user: None,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        };

        let tools = vec![
            McpTool::new("tool1", "server1", serde_json::json!({})),
            McpTool::new("tool2", "server1", serde_json::json!({})),
        ];

        // Should allow all tools when no permission manager
        let allowed = integration
            .filter_allowed_tools(tools.clone(), &context)
            .await;
        assert_eq!(allowed.len(), 2);
    }

    #[tokio::test]
    async fn test_check_tools_permissions_multiple() {
        let integration = McpIntegration::new();
        let context = PermissionContext {
            working_directory: std::path::PathBuf::from("/tmp"),
            session_id: "test".to_string(),
            timestamp: 0,
            user: None,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        };

        let tools = vec![
            (
                "server1".to_string(),
                "tool1".to_string(),
                serde_json::Map::new(),
            ),
            (
                "server2".to_string(),
                "tool2".to_string(),
                serde_json::Map::new(),
            ),
        ];

        let results = integration.check_tools_permissions(&tools, &context).await;
        assert_eq!(results.len(), 2);

        // All should be allowed when no permission manager
        for (_, result) in results {
            assert!(result.allowed);
        }
    }
}
