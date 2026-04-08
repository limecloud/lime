//! LSP Client
//!
//! Language Server Protocol 客户端实现

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex, RwLock};

use super::types::*;

/// LSP 请求响应发送器类型
pub(crate) type LspResponseSender = tokio::sync::oneshot::Sender<Result<Value, LspError>>;

/// LSP 待处理请求映射类型
pub(crate) type PendingRequestsMap = Arc<Mutex<HashMap<u64, LspResponseSender>>>;

/// LSP 消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspMessage {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<LspError>,
}

/// LSP 错误
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// LSP 服务器状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LspServerState {
    Stopped,
    Starting,
    Running,
    Error,
}

/// LSP 客户端配置
#[derive(Debug, Clone)]
pub struct LspClientConfig {
    /// 命令
    pub command: String,
    /// 参数
    pub args: Vec<String>,
    /// 根目录 URI
    pub root_uri: Option<String>,
    /// 初始化选项
    pub initialization_options: Option<Value>,
}

/// LSP 客户端事件
#[derive(Debug, Clone)]
pub enum LspClientEvent {
    StateChange(LspServerState),
    Notification { method: String, params: Value },
    Error(String),
}

/// LSP 客户端
pub struct LspClient {
    language: String,
    config: LspClientConfig,
    state: Arc<RwLock<LspServerState>>,
    process: Arc<Mutex<Option<Child>>>,
    message_id: AtomicU64,
    pending_requests: PendingRequestsMap,
    capabilities: Arc<RwLock<Option<Value>>>,
    event_sender: broadcast::Sender<LspClientEvent>,
}

impl LspClient {
    /// 创建新的 LSP 客户端
    pub fn new(language: impl Into<String>, config: LspClientConfig) -> Self {
        let (event_sender, _) = broadcast::channel(64);
        Self {
            language: language.into(),
            config,
            state: Arc::new(RwLock::new(LspServerState::Stopped)),
            process: Arc::new(Mutex::new(None)),
            message_id: AtomicU64::new(0),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            capabilities: Arc::new(RwLock::new(None)),
            event_sender,
        }
    }

    /// 订阅事件
    pub fn subscribe(&self) -> broadcast::Receiver<LspClientEvent> {
        self.event_sender.subscribe()
    }

    /// 获取状态
    pub async fn get_state(&self) -> LspServerState {
        *self.state.read().await
    }

    /// 获取能力
    pub async fn get_capabilities(&self) -> Option<Value> {
        self.capabilities.read().await.clone()
    }

    /// 启动 LSP 服务器
    pub async fn start(&self) -> Result<bool, String> {
        let current_state = *self.state.read().await;
        if current_state == LspServerState::Running {
            return Ok(true);
        }

        *self.state.write().await = LspServerState::Starting;
        let _ = self
            .event_sender
            .send(LspClientEvent::StateChange(LspServerState::Starting));

        // 启动进程
        let child = Command::new(&self.config.command)
            .args(&self.config.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn LSP server: {}", e))?;

        *self.process.lock().await = Some(child);

        // 发送 initialize 请求
        let init_params = serde_json::json!({
            "processId": std::process::id(),
            "capabilities": {
                "textDocument": {
                    "documentSymbol": {
                        "hierarchicalDocumentSymbolSupport": true
                    },
                    "references": {
                        "dynamicRegistration": false
                    },
                    "definition": {
                        "dynamicRegistration": false
                    }
                }
            },
            "rootUri": self.config.root_uri,
            "initializationOptions": self.config.initialization_options
        });

        match self.send_request("initialize", init_params).await {
            Ok(result) => {
                if let Some(caps) = result.get("capabilities") {
                    *self.capabilities.write().await = Some(caps.clone());
                }

                // 发送 initialized 通知
                self.send_notification("initialized", serde_json::json!({}))
                    .await;

                *self.state.write().await = LspServerState::Running;
                let _ = self
                    .event_sender
                    .send(LspClientEvent::StateChange(LspServerState::Running));
                Ok(true)
            }
            Err(e) => {
                *self.state.write().await = LspServerState::Error;
                let _ = self
                    .event_sender
                    .send(LspClientEvent::StateChange(LspServerState::Error));
                Err(format!("Initialize failed: {}", e))
            }
        }
    }

    /// 停止 LSP 服务器
    pub async fn stop(&self) {
        if *self.state.read().await == LspServerState::Stopped {
            return;
        }

        // 发送 shutdown 请求
        let _ = self.send_request("shutdown", Value::Null).await;
        self.send_notification("exit", Value::Null).await;

        // 终止进程
        if let Some(mut child) = self.process.lock().await.take() {
            let _ = child.kill();
        }

        *self.state.write().await = LspServerState::Stopped;
        let _ = self
            .event_sender
            .send(LspClientEvent::StateChange(LspServerState::Stopped));
    }

    /// 发送请求
    async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.message_id.fetch_add(1, Ordering::SeqCst);

        let message = LspMessage {
            jsonrpc: "2.0".to_string(),
            id: Some(id),
            method: Some(method.to_string()),
            params: Some(params),
            result: None,
            error: None,
        };

        self.send_message(&message).await?;

        // 简化实现：同步等待响应
        // 实际实现需要异步读取响应
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        Ok(Value::Null)
    }

    /// 发送通知
    async fn send_notification(&self, method: &str, params: Value) {
        let message = LspMessage {
            jsonrpc: "2.0".to_string(),
            id: None,
            method: Some(method.to_string()),
            params: Some(params),
            result: None,
            error: None,
        };

        let _ = self.send_message(&message).await;
    }

    /// 发送消息
    async fn send_message(&self, message: &LspMessage) -> Result<(), String> {
        let content = serde_json::to_string(message)
            .map_err(|e| format!("Failed to serialize message: {}", e))?;

        let header = format!("Content-Length: {}\r\n\r\n", content.len());

        let mut process = self.process.lock().await;
        if let Some(ref mut child) = *process {
            if let Some(ref mut stdin) = child.stdin {
                stdin
                    .write_all(header.as_bytes())
                    .map_err(|e| format!("Failed to write header: {}", e))?;
                stdin
                    .write_all(content.as_bytes())
                    .map_err(|e| format!("Failed to write content: {}", e))?;
                stdin
                    .flush()
                    .map_err(|e| format!("Failed to flush: {}", e))?;
            }
        }

        Ok(())
    }

    /// 获取文档符号
    pub async fn get_document_symbols(&self, uri: &str) -> Result<Vec<Value>, String> {
        if *self.state.read().await != LspServerState::Running {
            return Err("LSP server is not running".to_string());
        }

        let params = serde_json::json!({
            "textDocument": { "uri": uri }
        });

        let result = self
            .send_request("textDocument/documentSymbol", params)
            .await?;

        match result {
            Value::Array(symbols) => Ok(symbols),
            Value::Null => Ok(Vec::new()),
            _ => Ok(Vec::new()),
        }
    }

    /// 打开文档
    pub async fn open_document(&self, uri: &str, language_id: &str, version: i32, text: &str) {
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "languageId": language_id,
                "version": version,
                "text": text
            }
        });

        self.send_notification("textDocument/didOpen", params).await;
    }

    /// 关闭文档
    pub async fn close_document(&self, uri: &str) {
        let params = serde_json::json!({
            "textDocument": { "uri": uri }
        });

        self.send_notification("textDocument/didClose", params)
            .await;
    }

    /// 查找引用
    pub async fn find_references(
        &self,
        uri: &str,
        position: LspPosition,
    ) -> Result<Vec<LspLocation>, String> {
        if *self.state.read().await != LspServerState::Running {
            return Err("LSP server is not running".to_string());
        }

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": position.line, "character": position.character },
            "context": { "includeDeclaration": true }
        });

        let result = self.send_request("textDocument/references", params).await?;

        match result {
            Value::Array(locations) => {
                let parsed: Vec<LspLocation> = locations
                    .iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect();
                Ok(parsed)
            }
            _ => Ok(Vec::new()),
        }
    }

    /// 跳转到定义
    pub async fn get_definition(
        &self,
        uri: &str,
        position: LspPosition,
    ) -> Result<Option<LspLocation>, String> {
        if *self.state.read().await != LspServerState::Running {
            return Err("LSP server is not running".to_string());
        }

        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": position.line, "character": position.character }
        });

        let result = self.send_request("textDocument/definition", params).await?;

        match result {
            Value::Array(locations) if !locations.is_empty() => {
                serde_json::from_value(locations[0].clone())
                    .map(Some)
                    .map_err(|e| format!("Failed to parse location: {}", e))
            }
            Value::Object(_) => serde_json::from_value(result)
                .map(Some)
                .map_err(|e| format!("Failed to parse location: {}", e)),
            _ => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lsp_server_state() {
        assert_eq!(LspServerState::Stopped, LspServerState::Stopped);
        assert_ne!(LspServerState::Running, LspServerState::Stopped);
    }

    #[test]
    fn test_lsp_client_config() {
        let config = LspClientConfig {
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            root_uri: Some("file:///tmp".to_string()),
            initialization_options: None,
        };
        assert_eq!(config.command, "typescript-language-server");
    }

    #[test]
    fn test_lsp_message_serialize() {
        let msg = LspMessage {
            jsonrpc: "2.0".to_string(),
            id: Some(1),
            method: Some("initialize".to_string()),
            params: Some(serde_json::json!({})),
            result: None,
            error: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("jsonrpc"));
        assert!(json.contains("initialize"));
    }
}
