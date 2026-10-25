//! MCP 协议、状态与工具类型。

use crate::auth_status::McpServerAuthStatus;
pub use crate::mcp_types::{
    McpServerConfig, McpServerOAuthConfig, McpServerTransport, DEFAULT_MCP_SERVER_ENVIRONMENT_ID,
};
use serde::{Deserialize, Serialize};

/// MCP 服务器信息（包含运行状态）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub config: McpServerConfig,
    pub is_running: bool,
    pub server_info: Option<McpServerCapabilities>,
    pub enabled_lime: bool,
}

/// MCP server 运行时状态快照。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct McpServerRuntimeStatus {
    pub name: String,
    pub transport: String,
    pub enabled: bool,
    pub is_running: bool,
    pub required: bool,
    pub supports_parallel_tool_calls: bool,
    pub startup_timeout: u64,
    pub tool_timeout: u64,
    pub enabled_tools: Option<Vec<String>>,
    pub disabled_tools: Vec<String>,
    pub server_info: Option<McpServerCapabilities>,
    pub auth_status: McpServerAuthStatus,
}

/// MCP 服务器能力
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerCapabilities {
    pub name: String,
    pub version: String,
    pub supports_tools: bool,
    pub supports_prompts: bool,
    pub supports_resources: bool,
}

// ============================================================================
// 工具类型
// ============================================================================

/// MCP 工具定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<serde_json::Value>,
    pub server_name: String,
    /// 是否延迟加载（不默认注入上下文）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deferred_loading: Option<bool>,
    /// 是否始终可见（即使 deferred_loading=true 也可见）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub always_visible: Option<bool>,
    /// 允许调用方（如 assistant/code_execution/tool_search）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_callers: Option<Vec<String>>,
    /// 工具输入示例
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_examples: Option<Vec<serde_json::Value>>,
    /// 标签（用于工具搜索）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

/// MCP 工具调用请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

/// MCP 工具调用结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    pub content: Vec<McpContent>,
    #[serde(
        default,
        rename = "structuredContent",
        alias = "structured_content",
        skip_serializing_if = "Option::is_none"
    )]
    pub structured_content: Option<serde_json::Value>,
    pub is_error: bool,
}

/// MCP 内容类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum McpContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { data: String, mime_type: String },
    #[serde(rename = "resource")]
    Resource {
        uri: String,
        text: Option<String>,
        blob: Option<String>,
    },
}

// ============================================================================
// 提示词类型
// ============================================================================

/// MCP 提示词定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPromptDefinition {
    pub name: String,
    pub description: Option<String>,
    pub arguments: Vec<McpPromptArgument>,
    pub server_name: String,
}

/// MCP 提示词参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPromptArgument {
    pub name: String,
    pub description: Option<String>,
    pub required: bool,
}

/// MCP 提示词结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPromptResult {
    pub description: Option<String>,
    pub messages: Vec<McpPromptMessage>,
}

/// MCP 提示词消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPromptMessage {
    pub role: String,
    pub content: McpContent,
}

// ============================================================================
// 资源类型
// ============================================================================

/// MCP 资源定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResourceDefinition {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    pub mime_type: Option<String>,
    pub server_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
}

/// MCP 资源分页结果，保留 provider 需要的 opaque cursor。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResourcePage {
    pub resources: Vec<McpResourceDefinition>,
    pub next_cursor: Option<String>,
}

/// MCP 资源模板定义。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResourceTemplateDefinition {
    pub uri_template: String,
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub mime_type: Option<String>,
    pub server_name: String,
}

/// MCP 资源内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResourceContent {
    pub uri: String,
    pub mime_type: Option<String>,
    pub text: Option<String>,
    pub blob: Option<String>,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpResourceOrigin {
    pub call_id: String,
    pub turn_id: Option<String>,
    pub tool: String,
    pub connector_id: String,
    pub link_id: Option<String>,
    pub uri: String,
    pub ambiguous_account: bool,
}

// ============================================================================
// 错误类型
// ============================================================================

/// MCP 错误类型
#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("服务器配置不存在: {0}")]
    ConfigNotFound(String),

    #[error("服务器已在运行: {0}")]
    ServerAlreadyRunning(String),

    #[error("服务器未运行: {0}")]
    ServerNotRunning(String),

    #[error("无法启动服务器进程: {0}")]
    ProcessSpawnFailed(String),

    #[error("MCP 连接失败: {0}")]
    ConnectionFailed(String),

    #[error("工具不存在: {0}")]
    ToolNotFound(String),

    #[error("工具调用失败: {0}")]
    ToolCallFailed(String),

    #[error("操作超时")]
    Timeout,

    #[error("数据库错误: {0}")]
    DatabaseError(String),

    #[error("协议错误: {0}")]
    ProtocolError(String),

    #[error("配置错误: {0}")]
    ConfigError(String),
}

// ============================================================================
// 状态类型
// ============================================================================

use std::sync::Arc;
use tokio::sync::Mutex;

/// MCP 客户端管理器状态
///
/// 使用 Arc<Mutex<McpClientManager>> 包装，支持跨线程共享和异步访问。
pub type McpManagerState = Arc<Mutex<super::manager::McpClientManager>>;
