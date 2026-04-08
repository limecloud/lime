//! Chrome MCP 模块 - 与官方 Claude Code Chrome 扩展集成
//!
//! 完全对齐官方实现，复用官方 Chrome 扩展
//!
//! # 模块结构
//! - `types` - 类型定义
//! - `native_host` - Native Host 管理
//! - `socket_client` - Socket 客户端
//! - `socket_server` - Socket 服务器
//! - `mcp_server` - MCP 服务器
//! - `tools` - MCP 工具定义

pub mod mcp_server;
pub mod native_host;
pub mod socket_client;
pub mod socket_server;
pub mod tools;
pub mod types;

// Re-exports
pub use mcp_server::McpServer;
pub use native_host::{
    get_native_hosts_directory, get_platform, get_socket_path, is_chrome_integration_configured,
    is_chrome_integration_supported, setup_chrome_native_host, uninstall_chrome_native_host,
    SetupResult,
};
pub use socket_client::{create_socket_client, SocketClient, SocketConnectionError};
pub use socket_server::{run_native_host, SocketServer};
pub use tools::{get_chrome_mcp_tools, McpTool};
pub use types::Platform;
pub use types::{
    ChromeIntegrationConfig, McpServerConfig, ToolCallResult, ToolErrorContent, ToolResultContent,
};
