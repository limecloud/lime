//! Socket Client - 连接到 Native Host Socket Server
//!
//! 架构：
//! MCP Server (包含此 Socket Client) → Socket → Native Host → Native Messaging → Chrome 扩展

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[cfg(unix)]
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;

use super::native_host::get_socket_path;
use super::types::ToolCallResult;

/// 最大消息大小 (1MB)
const MAX_MESSAGE_SIZE: u32 = 1048576;
/// 连接超时 (5秒)
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// 工具调用超时 (60秒)
const TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(60);
/// 重连延迟 (1秒)
#[allow(dead_code)]
const RECONNECT_DELAY: Duration = Duration::from_secs(1);
/// 最大重连次数
#[allow(dead_code)]
const MAX_RECONNECT_ATTEMPTS: u32 = 10;

/// Socket 连接错误
#[derive(Debug, Clone)]
pub struct SocketConnectionError {
    pub message: String,
}

impl std::fmt::Display for SocketConnectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SocketConnectionError: {}", self.message)
    }
}

impl std::error::Error for SocketConnectionError {}

impl SocketConnectionError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// 等待中的工具调用
struct PendingCall {
    sender: oneshot::Sender<Result<ToolCallResult, SocketConnectionError>>,
}

/// Socket Client 内部状态
struct ClientState {
    connected: bool,
    connecting: bool,
    pending_calls: HashMap<String, PendingCall>,
    reconnect_attempts: u32,
}

/// Socket Client - 连接到 Native Host Socket Server
pub struct SocketClient {
    state: Arc<Mutex<ClientState>>,
    call_id: AtomicU64,
    #[cfg(unix)]
    writer: Arc<Mutex<Option<tokio::net::unix::OwnedWriteHalf>>>,
    #[cfg(windows)]
    writer: Arc<Mutex<Option<tokio::net::windows::named_pipe::NamedPipeClient>>>,
    shutdown_tx: Arc<Mutex<Option<mpsc::Sender<()>>>>,
}

impl SocketClient {
    /// 创建新的 Socket Client
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(ClientState {
                connected: false,
                connecting: false,
                pending_calls: HashMap::new(),
                reconnect_attempts: 0,
            })),
            call_id: AtomicU64::new(0),
            writer: Arc::new(Mutex::new(None)),
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// 检查是否已连接
    pub async fn is_connected(&self) -> bool {
        self.state.lock().await.connected
    }

    /// 确保已连接
    pub async fn ensure_connected(&self) -> bool {
        {
            let state = self.state.lock().await;
            if state.connected {
                return true;
            }
            if state.connecting {
                drop(state);
                // 等待连接完成
                for _ in 0..50 {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    let state = self.state.lock().await;
                    if state.connected {
                        return true;
                    }
                    if !state.connecting {
                        return false;
                    }
                }
                return false;
            }
        }

        match self.connect().await {
            Ok(_) => self.state.lock().await.connected,
            Err(e) => {
                tracing::warn!("Failed to connect to socket: {}", e);
                false
            }
        }
    }

    /// 连接到 Socket Server (Unix)
    #[cfg(unix)]
    async fn connect(&self) -> Result<(), SocketConnectionError> {
        {
            let mut state = self.state.lock().await;
            if state.connected || state.connecting {
                return Ok(());
            }
            state.connecting = true;
        }

        let socket_path = get_socket_path();

        let connect_result = timeout(
            CONNECT_TIMEOUT,
            tokio::net::UnixStream::connect(&socket_path),
        )
        .await;

        match connect_result {
            Ok(Ok(stream)) => {
                let (reader, writer) = stream.into_split();
                *self.writer.lock().await = Some(writer);

                let state_clone = Arc::clone(&self.state);
                let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);
                *self.shutdown_tx.lock().await = Some(shutdown_tx);

                // 启动读取任务
                tokio::spawn(async move {
                    Self::read_loop(reader, state_clone, shutdown_rx).await;
                });

                let mut state = self.state.lock().await;
                state.connected = true;
                state.connecting = false;
                state.reconnect_attempts = 0;
                tracing::info!("Connected to socket server");
                Ok(())
            }
            Ok(Err(e)) => {
                let mut state = self.state.lock().await;
                state.connecting = false;
                Err(SocketConnectionError::new(format!(
                    "Connection failed: {}",
                    e
                )))
            }
            Err(_) => {
                let mut state = self.state.lock().await;
                state.connecting = false;
                Err(SocketConnectionError::new("Connection timeout"))
            }
        }
    }

    /// 连接到 Socket Server (Windows)
    #[cfg(windows)]
    async fn connect(&self) -> Result<(), SocketConnectionError> {
        {
            let mut state = self.state.lock().await;
            if state.connected || state.connecting {
                return Ok(());
            }
            state.connecting = true;
        }

        let socket_path = get_socket_path();

        // Windows named pipe 连接
        let connect_result = timeout(CONNECT_TIMEOUT, async {
            tokio::net::windows::named_pipe::ClientOptions::new().open(&socket_path)
        })
        .await;

        match connect_result {
            Ok(Ok(pipe)) => {
                *self.writer.lock().await = Some(pipe);

                let mut state = self.state.lock().await;
                state.connected = true;
                state.connecting = false;
                state.reconnect_attempts = 0;
                tracing::info!("Connected to socket server");
                Ok(())
            }
            Ok(Err(e)) => {
                let mut state = self.state.lock().await;
                state.connecting = false;
                Err(SocketConnectionError::new(format!(
                    "Connection failed: {}",
                    e
                )))
            }
            Err(_) => {
                let mut state = self.state.lock().await;
                state.connecting = false;
                Err(SocketConnectionError::new("Connection timeout"))
            }
        }
    }

    /// Unix 读取循环
    #[cfg(unix)]
    async fn read_loop(
        mut reader: tokio::net::unix::OwnedReadHalf,
        state: Arc<Mutex<ClientState>>,
        mut shutdown_rx: mpsc::Receiver<()>,
    ) {
        let mut buffer = Vec::new();
        let mut read_buf = [0u8; 4096];

        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    tracing::info!("Socket read loop shutdown");
                    break;
                }
                result = reader.read(&mut read_buf) => {
                    match result {
                        Ok(0) => {
                            tracing::info!("Socket connection closed");
                            Self::handle_disconnect(state).await;
                            break;
                        }
                        Ok(n) => {
                            buffer.extend_from_slice(&read_buf[..n]);
                            Self::process_buffer(&mut buffer, &state).await;
                        }
                        Err(e) => {
                            tracing::error!("Socket read error: {}", e);
                            Self::handle_disconnect(state).await;
                            break;
                        }
                    }
                }
            }
        }
    }

    /// 处理断开连接
    async fn handle_disconnect(state: Arc<Mutex<ClientState>>) {
        let mut state = state.lock().await;
        state.connected = false;
        state.connecting = false;

        // 拒绝所有等待中的调用
        for (_, pending) in state.pending_calls.drain() {
            let _ = pending
                .sender
                .send(Err(SocketConnectionError::new("Connection closed")));
        }
    }

    /// 处理缓冲区中的消息
    async fn process_buffer(buffer: &mut Vec<u8>, state: &Arc<Mutex<ClientState>>) {
        while buffer.len() >= 4 {
            let msg_len = u32::from_le_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]);

            if msg_len == 0 || msg_len > MAX_MESSAGE_SIZE {
                tracing::error!("Invalid message length: {}", msg_len);
                buffer.clear();
                return;
            }

            let total_len = 4 + msg_len as usize;
            if buffer.len() < total_len {
                return; // 消息不完整
            }

            let msg_data = &buffer[4..total_len];
            if let Ok(msg_str) = std::str::from_utf8(msg_data) {
                Self::handle_message(msg_str, state).await;
            }

            buffer.drain(..total_len);
        }
    }

    /// 处理接收到的消息
    async fn handle_message(msg_str: &str, state: &Arc<Mutex<ClientState>>) {
        let msg: serde_json::Value = match serde_json::from_str(msg_str) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!("Failed to parse message: {}", e);
                return;
            }
        };

        tracing::debug!(
            "Received message: {}",
            msg_str.get(..msg_str.len().min(300)).unwrap_or(msg_str)
        );

        // 检查是否是工具调用响应
        if msg.get("result").is_some() || msg.get("error").is_some() {
            let result = super::types::ToolCallResult {
                result: msg.get("result").and_then(|r| {
                    r.get("content").map(|c| super::types::ToolResultContent {
                        content: c.as_array().cloned().unwrap_or_default(),
                    })
                }),
                error: msg.get("error").and_then(|e| {
                    e.get("content").map(|c| super::types::ToolErrorContent {
                        content: c.as_array().cloned().unwrap_or_default(),
                    })
                }),
            };

            let mut state = state.lock().await;
            // 处理第一个等待中的请求
            if let Some(call_id) = state.pending_calls.keys().next().cloned() {
                if let Some(pending) = state.pending_calls.remove(&call_id) {
                    let _ = pending.sender.send(Ok(result));
                }
            }
        }
    }

    /// 调用工具
    pub async fn call_tool(
        &self,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<ToolCallResult, SocketConnectionError> {
        if !self.is_connected().await {
            return Err(SocketConnectionError::new("Not connected"));
        }

        let call_id = format!(
            "call_{}_{}",
            self.call_id.fetch_add(1, Ordering::SeqCst),
            chrono::Utc::now().timestamp_millis()
        );

        let (tx, rx) = oneshot::channel();

        // 注册等待中的调用
        {
            let mut state = self.state.lock().await;
            state
                .pending_calls
                .insert(call_id.clone(), PendingCall { sender: tx });
        }

        // 构造消息
        let message = serde_json::json!({
            "type": "tool_request",
            "method": "execute_tool",
            "params": {
                "tool": tool_name,
                "client_id": "aster",
                "args": args
            }
        });

        // 发送消息
        if let Err(e) = self.send_message(&message).await {
            let mut state = self.state.lock().await;
            state.pending_calls.remove(&call_id);
            return Err(e);
        }

        // 等待响应
        match timeout(TOOL_CALL_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(SocketConnectionError::new("Response channel closed")),
            Err(_) => {
                let mut state = self.state.lock().await;
                state.pending_calls.remove(&call_id);
                Err(SocketConnectionError::new("Tool call timeout"))
            }
        }
    }

    /// 发送消息 (Unix)
    #[cfg(unix)]
    async fn send_message(&self, message: &serde_json::Value) -> Result<(), SocketConnectionError> {
        let json = serde_json::to_vec(message)
            .map_err(|e| SocketConnectionError::new(format!("Serialize error: {}", e)))?;

        let mut header = [0u8; 4];
        header.copy_from_slice(&(json.len() as u32).to_le_bytes());

        let mut writer = self.writer.lock().await;
        if let Some(ref mut w) = *writer {
            w.write_all(&header)
                .await
                .map_err(|e| SocketConnectionError::new(format!("Write error: {}", e)))?;
            w.write_all(&json)
                .await
                .map_err(|e| SocketConnectionError::new(format!("Write error: {}", e)))?;
            Ok(())
        } else {
            Err(SocketConnectionError::new("Not connected"))
        }
    }

    /// 发送消息 (Windows)
    #[cfg(windows)]
    async fn send_message(&self, message: &serde_json::Value) -> Result<(), SocketConnectionError> {
        let json = serde_json::to_vec(message)
            .map_err(|e| SocketConnectionError::new(format!("Serialize error: {}", e)))?;

        let mut header = [0u8; 4];
        header.copy_from_slice(&(json.len() as u32).to_le_bytes());

        let mut writer = self.writer.lock().await;
        if let Some(ref mut w) = *writer {
            w.write_all(&header)
                .await
                .map_err(|e| SocketConnectionError::new(format!("Write error: {}", e)))?;
            w.write_all(&json)
                .await
                .map_err(|e| SocketConnectionError::new(format!("Write error: {}", e)))?;
            Ok(())
        } else {
            Err(SocketConnectionError::new("Not connected"))
        }
    }

    /// 断开连接
    pub async fn disconnect(&self) {
        // 发送关闭信号
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(()).await;
        }

        // 清理 writer
        *self.writer.lock().await = None;

        // 更新状态
        let mut state = self.state.lock().await;
        state.connected = false;
        state.connecting = false;

        // 拒绝所有等待中的调用
        for (_, pending) in state.pending_calls.drain() {
            let _ = pending
                .sender
                .send(Err(SocketConnectionError::new("Disconnected")));
        }
    }
}

impl Default for SocketClient {
    fn default() -> Self {
        Self::new()
    }
}

/// 创建 Socket Client 实例
pub fn create_socket_client() -> SocketClient {
    SocketClient::new()
}
