//! Lime MCP Crate
//!
//! MCP（Model Context Protocol）集成模块，提供 MCP 协议的客户端实现。
//! 使用 DynEmitter 进行事件发射，与具体桌面宿主解耦。

mod active_time;
pub mod auth_status;
pub mod bridge_client;
pub mod catalog;
mod client;
mod client_service;
pub mod elicitation;
mod environment;
pub mod events;
pub mod extension_surface;
pub mod manager;
pub mod naming;
pub mod oauth;
pub mod oauth_store;
mod pagination;
mod plugin_config;
mod runtime_types;
mod server_key;
mod stdio_launcher;
mod stdio_process;
mod streamable_http;
pub mod tool_policy;
pub mod types;
mod utils;

pub use auth_status::{McpServerAuthActionPlan, McpServerAuthStatus};
pub use bridge_client::McpBridgeClient;
pub use catalog::{
    McpCatalog, McpPluginAttribution, McpServerExposure, McpServerSource, ResolvedMcpServer,
};
pub use client_service::LimeMcpClientService;
pub use elicitation::{
    ClaimedElicitationResolution, ElicitationAction, ElicitationRequest, ElicitationRequestId,
    ElicitationRequestRouter, ElicitationResponse, ElicitationRouterError,
};
pub use events::{
    McpEventStream, McpResourceUpdatedPayload, McpResourcesUpdatedPayload, McpServerNotification,
    McpToolsUpdatedPayload,
};
pub use extension_surface::{build_runtime_extension_surface, runtime_extension_name};
pub use manager::{McpBridgeSnapshot, McpClientManager, McpRuntimeOwner, McpRuntimeServerSpec};
pub use naming::{config_key_for_server_name, is_valid_server_name, validate_server_name};
pub use oauth::{McpOAuthLoginHandle, McpOAuthLoginParams, McpOAuthRegistry};
pub use plugin_config::parse_agent_plugin_mcp_config;
pub use plugin_config::parse_plugin_mcp_config;
pub use plugin_config::parse_plugin_mcp_declarations;
pub use plugin_config::PluginMcpConfigParseOutcome;
pub use plugin_config::PluginMcpServerParseError;
pub use rmcp_client::McpProtocolMode;
pub const LIME_APPS_MCP_SERVER_NAME: &str = "lime_apps";
pub const MCP_TOOL_LIME_APPS_META_KEY: &str = "_lime_apps";

pub use runtime_types::{
    McpConfig, McpResourceClient, McpResourceClientAuthKey, McpResourceServerCacheKey,
    PreparedMcpCall, ToolInfo,
};
pub use server_key::McpServerKey;
pub use types::{
    McpContent, McpError, McpManagerState, McpPromptArgument, McpPromptDefinition,
    McpPromptMessage, McpPromptResult, McpResourceContent, McpResourceDefinition,
    McpResourceOrigin, McpResourcePage, McpResourceTemplateDefinition, McpServerCapabilities,
    McpServerConfig, McpServerInfo, McpServerRuntimeStatus, McpServerTransport, McpToolCall,
    McpToolDefinition, McpToolResult, DEFAULT_MCP_SERVER_ENVIRONMENT_ID,
};
