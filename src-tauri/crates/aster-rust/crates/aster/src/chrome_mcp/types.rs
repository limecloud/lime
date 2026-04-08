//! Chrome MCP 类型定义

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Chrome 扩展 ID
pub const CHROME_EXTENSION_ID: &str = "fcoeoabgfenejglbffodgkkbkcdhcgfn";

/// Native Host 名称
pub const NATIVE_HOST_NAME: &str = "com.anthropic.claude_code_browser_extension";

/// Chrome 安装 URL
pub const CHROME_INSTALL_URL: &str = "https://claude.ai/chrome";

/// Chrome 重连 URL
pub const CHROME_RECONNECT_URL: &str = "https://clau.de/chrome/reconnect";

/// Chrome 权限 URL
pub const CHROME_PERMISSIONS_URL: &str = "https://clau.de/chrome/permissions";

/// 平台类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    MacOS,
    Linux,
    Windows,
    Wsl,
    Unknown,
}

/// Chrome 集成配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChromeIntegrationConfig {
    pub mcp_config: HashMap<String, McpServerConfig>,
    pub allowed_tools: Vec<String>,
    pub system_prompt: String,
}

/// MCP 服务器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    #[serde(rename = "type")]
    pub server_type: String,
    pub command: String,
    pub args: Vec<String>,
    pub scope: String,
}

/// 工具调用结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub result: Option<ToolResultContent>,
    pub error: Option<ToolErrorContent>,
}

/// 工具结果内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResultContent {
    pub content: Vec<serde_json::Value>,
}

/// 工具错误内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolErrorContent {
    pub content: Vec<serde_json::Value>,
}
