//! Chrome MCP Server - 与 CLI 通信的 MCP 服务器
//!
//! 架构：
//! CLI ↔ stdio ↔ MCP Server ↔ Socket ↔ Native Host ↔ Native Messaging ↔ Chrome 扩展

use std::io::{BufRead, Write};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use super::socket_client::{create_socket_client, SocketClient, SocketConnectionError};
use super::tools::get_chrome_mcp_tools;
use super::types::CHROME_INSTALL_URL;

/// MCP 服务器配置
#[derive(Debug, Clone)]
pub struct McpServerConfig {
    pub server_name: String,
    pub client_type_id: String,
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            server_name: "Aster in Chrome".to_string(),
            client_type_id: "aster".to_string(),
        }
    }
}

/// MCP 工具调用结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    pub content: Vec<McpContent>,
    #[serde(rename = "isError", skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

/// MCP 内容项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpContent {
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// MCP 请求
#[derive(Debug, Deserialize)]
struct McpRequest {
    id: serde_json::Value,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

/// MCP 服务器实现
pub struct McpServer {
    config: McpServerConfig,
    socket_client: Arc<Mutex<SocketClient>>,
    running: Arc<Mutex<bool>>,
}

impl McpServer {
    /// 创建新的 MCP 服务器
    pub fn new(config: McpServerConfig) -> Self {
        Self {
            config,
            socket_client: Arc::new(Mutex::new(create_socket_client())),
            running: Arc::new(Mutex::new(false)),
        }
    }

    /// 启动 MCP 服务器
    pub async fn start(&self) -> Result<(), String> {
        {
            let mut running = self.running.lock().await;
            if *running {
                return Ok(());
            }
            *running = true;
        }

        tracing::info!("Starting MCP server");

        // 尝试初始连接
        let client = self.socket_client.lock().await;
        let _ = client.ensure_connected().await;
        drop(client);

        // 从 stdin 读取消息
        self.read_loop().await;

        Ok(())
    }

    /// 读取循环
    async fn read_loop(&self) {
        let stdin = std::io::stdin();
        let reader = stdin.lock();

        for line in reader.lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    if let Err(e) = self.handle_message(&line).await {
                        tracing::error!("Failed to handle message: {}", e);
                    }
                }
                Ok(_) => continue,
                Err(e) => {
                    tracing::error!("Failed to read from stdin: {}", e);
                    break;
                }
            }
        }
    }

    /// 处理 MCP 消息
    async fn handle_message(&self, message: &str) -> Result<(), String> {
        let request: McpRequest =
            serde_json::from_str(message).map_err(|e| format!("Failed to parse request: {}", e))?;

        tracing::debug!("Received request: {}", request.method);

        let result = match request.method.as_str() {
            "initialize" => self.handle_initialize().await,
            "tools/list" => self.handle_tools_list().await,
            "tools/call" => self.handle_tools_call(&request.params).await,
            _ => Err(format!("Method not found: {}", request.method)),
        };

        match result {
            Ok(result) => self.send_response(&request.id, result),
            Err(e) => self.send_error(&request.id, -32601, &e),
        }

        Ok(())
    }

    /// 处理 initialize 请求
    async fn handle_initialize(&self) -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": self.config.server_name,
                "version": "1.0.0"
            }
        }))
    }

    /// 处理 tools/list 请求
    async fn handle_tools_list(&self) -> Result<serde_json::Value, String> {
        let tools = get_chrome_mcp_tools();
        Ok(serde_json::json!({ "tools": tools }))
    }

    /// 处理 tools/call 请求
    async fn handle_tools_call(
        &self,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let name = params
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing tool name".to_string())?;

        let args = params
            .get("arguments")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        tracing::info!("Executing tool: {}", name);

        let result = self.execute_tool_call(name, args).await;
        Ok(serde_json::to_value(result).unwrap_or_default())
    }

    /// 执行工具调用
    async fn execute_tool_call(&self, tool_name: &str, args: serde_json::Value) -> McpToolResult {
        let client = self.socket_client.lock().await;

        let connected = client.ensure_connected().await;
        if !connected {
            return self.get_disconnected_response();
        }

        match client.call_tool(tool_name, args).await {
            Ok(result) => self.process_tool_result(result),
            Err(e) => {
                if matches!(e, SocketConnectionError { .. }) {
                    self.get_disconnected_response()
                } else {
                    McpToolResult {
                        content: vec![McpContent {
                            content_type: "text".to_string(),
                            text: Some(format!("Error calling tool: {}", e)),
                            data: None,
                            mime_type: None,
                        }],
                        is_error: Some(true),
                    }
                }
            }
        }
    }

    /// 处理工具调用结果
    fn process_tool_result(&self, result: super::types::ToolCallResult) -> McpToolResult {
        if let Some(error) = result.error {
            let content = self.normalize_content_from_vec(&error.content);
            return McpToolResult {
                content,
                is_error: Some(true),
            };
        }

        if let Some(result_content) = result.result {
            return McpToolResult {
                content: self.normalize_content_from_vec(&result_content.content),
                is_error: Some(false),
            };
        }

        McpToolResult {
            content: vec![McpContent {
                content_type: "text".to_string(),
                text: Some("Tool execution completed".to_string()),
                data: None,
                mime_type: None,
            }],
            is_error: Some(false),
        }
    }

    /// 标准化内容格式
    #[allow(dead_code)]
    fn normalize_content(&self, content: &serde_json::Value) -> Vec<McpContent> {
        // 处理字符串类型
        if let Some(s) = content.as_str() {
            return vec![McpContent {
                content_type: "text".to_string(),
                text: Some(s.to_string()),
                data: None,
                mime_type: None,
            }];
        }

        // 处理数组类型
        if let Some(arr) = content.as_array() {
            return self.normalize_content_from_vec(arr);
        }

        // 默认处理
        vec![McpContent {
            content_type: "text".to_string(),
            text: Some(content.to_string()),
            data: None,
            mime_type: None,
        }]
    }

    /// 从 Vec 标准化内容格式
    fn normalize_content_from_vec(&self, arr: &[serde_json::Value]) -> Vec<McpContent> {
        arr.iter()
            .map(|item| {
                if let Some(s) = item.as_str() {
                    McpContent {
                        content_type: "text".to_string(),
                        text: Some(s.to_string()),
                        data: None,
                        mime_type: None,
                    }
                } else if let Some(obj) = item.as_object() {
                    let content_type = obj
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("text")
                        .to_string();

                    McpContent {
                        content_type,
                        text: obj.get("text").and_then(|v| v.as_str()).map(String::from),
                        data: obj.get("data").and_then(|v| v.as_str()).map(String::from),
                        mime_type: obj
                            .get("mimeType")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    }
                } else {
                    McpContent {
                        content_type: "text".to_string(),
                        text: Some(item.to_string()),
                        data: None,
                        mime_type: None,
                    }
                }
            })
            .collect()
    }

    /// 获取断开连接时的响应
    fn get_disconnected_response(&self) -> McpToolResult {
        McpToolResult {
            content: vec![McpContent {
                content_type: "text".to_string(),
                text: Some(format!(
                    "Browser extension is not connected. Please ensure the browser extension is installed and running ({}).",
                    CHROME_INSTALL_URL
                )),
                data: None,
                mime_type: None,
            }],
            is_error: Some(true),
        }
    }

    /// 发送响应
    fn send_response(&self, id: &serde_json::Value, result: serde_json::Value) {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        });
        let mut stdout = std::io::stdout().lock();
        let _ = writeln!(stdout, "{}", response);
        let _ = stdout.flush();
    }

    /// 发送错误
    fn send_error(&self, id: &serde_json::Value, code: i32, message: &str) {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message }
        });
        let mut stdout = std::io::stdout().lock();
        let _ = writeln!(stdout, "{}", response);
        let _ = stdout.flush();
    }

    /// 停止 MCP 服务器
    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        if !*running {
            return;
        }
        *running = false;

        let client = self.socket_client.lock().await;
        client.disconnect().await;
        tracing::info!("MCP server stopped");
    }
}

/// 运行 MCP 服务器
pub async fn run_mcp_server() -> Result<(), String> {
    let config = McpServerConfig::default();
    let server = McpServer::new(config);
    server.start().await
}
