//! Socket Server - 运行在 Native Host 进程中
//!
//! 架构：
//! Chrome 扩展 → Native Messaging → Native Host (包含此 Socket Server) ← Socket ← MCP Client
//!
//! 平台支持：
//! - Unix: 使用 Unix Domain Socket
//! - Windows: 使用 Named Pipe

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use super::native_host::get_socket_path;

/// Native Host 版本
const NATIVE_HOST_VERSION: &str = "1.0.0";
/// 最大消息大小 (1MB)
const MAX_MESSAGE_SIZE: u32 = 1048576;

/// MCP 客户端信息 (Unix)
#[cfg(unix)]
#[allow(dead_code)]
struct McpClientInfo {
    id: u32,
    writer: tokio::net::unix::OwnedWriteHalf,
}

/// MCP 客户端信息 (Windows)
#[cfg(windows)]
#[allow(dead_code)]
struct McpClientInfo {
    id: u32,
    pipe: Arc<Mutex<tokio::net::windows::named_pipe::NamedPipeServer>>,
}

/// Socket Server - 管理与 MCP 客户端的连接
pub struct SocketServer {
    mcp_clients: Arc<Mutex<HashMap<u32, McpClientInfo>>>,
    next_client_id: AtomicU32,
    running: Arc<Mutex<bool>>,
}

impl SocketServer {
    /// 创建新的 Socket Server
    pub fn new() -> Self {
        Self {
            mcp_clients: Arc::new(Mutex::new(HashMap::new())),
            next_client_id: AtomicU32::new(1),
            running: Arc::new(Mutex::new(false)),
        }
    }

    /// 启动 Socket 服务器 (Unix)
    #[cfg(unix)]
    pub async fn start(&self) -> Result<(), String> {
        let mut running = self.running.lock().await;
        if *running {
            return Ok(());
        }

        let socket_path = get_socket_path();
        log_message(&format!("Creating socket listener: {}", socket_path));

        // 清理旧的 socket 文件
        let _ = std::fs::remove_file(&socket_path);

        let listener = tokio::net::UnixListener::bind(&socket_path)
            .map_err(|e| format!("Failed to bind socket: {}", e))?;

        // 设置权限
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            let _ = std::fs::set_permissions(&socket_path, perms);
        }

        *running = true;
        log_message("Socket server listening for connections");

        let clients = Arc::clone(&self.mcp_clients);
        let next_id = &self.next_client_id;

        // 接受连接循环
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let id = next_id.fetch_add(1, Ordering::SeqCst);
                    self.handle_mcp_client(id, stream, Arc::clone(&clients))
                        .await;
                }
                Err(e) => {
                    log_message(&format!("Accept error: {}", e));
                }
            }
        }
    }

    /// 启动 Socket 服务器 (Windows - Named Pipe)
    #[cfg(windows)]
    pub async fn start(&self) -> Result<(), String> {
        use tokio::net::windows::named_pipe::ServerOptions;

        let mut running = self.running.lock().await;
        if *running {
            return Ok(());
        }

        let pipe_path = get_socket_path();
        log_message(&format!("Creating named pipe server: {}", pipe_path));

        *running = true;
        log_message("Named pipe server listening for connections");

        let clients = Arc::clone(&self.mcp_clients);
        let next_id = &self.next_client_id;

        // 接受连接循环
        loop {
            // 创建新的 Named Pipe 实例
            let server = ServerOptions::new()
                .first_pipe_instance(false)
                .create(&pipe_path)
                .map_err(|e| format!("Failed to create named pipe: {}", e))?;

            // 等待客户端连接
            if let Err(e) = server.connect().await {
                log_message(&format!("Named pipe connect error: {}", e));
                continue;
            }

            let id = next_id.fetch_add(1, Ordering::SeqCst);
            self.handle_mcp_client_windows(id, server, Arc::clone(&clients))
                .await;
        }
    }

    /// 处理 MCP 客户端连接 (Unix)
    #[cfg(unix)]
    async fn handle_mcp_client(
        &self,
        id: u32,
        stream: tokio::net::UnixStream,
        clients: Arc<Mutex<HashMap<u32, McpClientInfo>>>,
    ) {
        let (mut reader, writer) = stream.into_split();

        {
            let mut clients = clients.lock().await;
            clients.insert(id, McpClientInfo { id, writer });
            log_message(&format!(
                "MCP client {} connected. Total: {}",
                id,
                clients.len()
            ));
        }

        // 通知 Chrome 扩展
        send_to_chrome(&serde_json::json!({ "type": "mcp_connected" }));

        let clients_clone = Arc::clone(&clients);

        // 读取循环
        tokio::spawn(async move {
            let mut buffer = Vec::new();
            let mut read_buf = [0u8; 4096];

            loop {
                match reader.read(&mut read_buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        buffer.extend_from_slice(&read_buf[..n]);
                        Self::process_mcp_buffer(&mut buffer, id).await;
                    }
                    Err(_) => break,
                }
            }

            let mut clients = clients_clone.lock().await;
            clients.remove(&id);
            log_message(&format!(
                "MCP client {} disconnected. Total: {}",
                id,
                clients.len()
            ));
        });
    }

    /// 处理 MCP 客户端连接 (Windows)
    #[cfg(windows)]
    async fn handle_mcp_client_windows(
        &self,
        id: u32,
        server: tokio::net::windows::named_pipe::NamedPipeServer,
        clients: Arc<Mutex<HashMap<u32, McpClientInfo>>>,
    ) {
        let pipe = Arc::new(Mutex::new(server));

        {
            let mut clients = clients.lock().await;
            clients.insert(
                id,
                McpClientInfo {
                    id,
                    pipe: Arc::clone(&pipe),
                },
            );
            log_message(&format!(
                "MCP client {} connected. Total: {}",
                id,
                clients.len()
            ));
        }

        // 通知 Chrome 扩展
        send_to_chrome(&serde_json::json!({ "type": "mcp_connected" }));

        let clients_clone = Arc::clone(&clients);
        let pipe_clone = Arc::clone(&pipe);

        // 读取循环
        tokio::spawn(async move {
            let mut buffer = Vec::new();
            let mut read_buf = [0u8; 4096];

            loop {
                let read_result = {
                    let mut pipe = pipe_clone.lock().await;
                    pipe.read(&mut read_buf).await
                };

                match read_result {
                    Ok(0) => break,
                    Ok(n) => {
                        buffer.extend_from_slice(&read_buf[..n]);
                        Self::process_mcp_buffer(&mut buffer, id).await;
                    }
                    Err(_) => break,
                }
            }

            let mut clients = clients_clone.lock().await;
            clients.remove(&id);
            log_message(&format!(
                "MCP client {} disconnected. Total: {}",
                id,
                clients.len()
            ));
        });
    }

    /// 处理 MCP 客户端缓冲区
    async fn process_mcp_buffer(buffer: &mut Vec<u8>, client_id: u32) {
        while buffer.len() >= 4 {
            let msg_len = u32::from_le_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]);

            if msg_len == 0 || msg_len > MAX_MESSAGE_SIZE {
                log_message(&format!(
                    "Invalid message length from client {}: {}",
                    client_id, msg_len
                ));
                buffer.clear();
                return;
            }

            let total_len = 4 + msg_len as usize;
            if buffer.len() < total_len {
                return;
            }

            let msg_data = &buffer[4..total_len];
            if let Ok(msg_str) = std::str::from_utf8(msg_data) {
                if let Ok(message) = serde_json::from_str::<serde_json::Value>(msg_str) {
                    log_message(&format!(
                        "Received from MCP client {}: {}",
                        client_id,
                        msg_str.get(..msg_str.len().min(200)).unwrap_or(msg_str)
                    ));
                    // 转发到 Chrome 扩展
                    send_to_chrome(&message);
                }
            }

            buffer.drain(..total_len);
        }
    }

    /// 处理来自 Chrome 扩展的消息
    pub async fn handle_chrome_message(&self, message: &str) -> Result<(), String> {
        log_message(&format!(
            "Chrome message: {}",
            message.get(..message.len().min(300)).unwrap_or(message)
        ));

        let data: serde_json::Value =
            serde_json::from_str(message).map_err(|e| format!("Parse error: {}", e))?;

        // 检查是否是工具响应
        if data.get("result").is_some() || data.get("error").is_some() {
            log_message("Received tool response, forwarding to MCP clients");
            self.forward_to_mcp_clients(&data).await;
            return Ok(());
        }

        // 处理其他消息类型
        if let Some(msg_type) = data.get("type").and_then(|v| v.as_str()) {
            match msg_type {
                "ping" => {
                    send_to_chrome(&serde_json::json!({
                        "type": "pong",
                        "timestamp": chrono::Utc::now().timestamp_millis()
                    }));
                }
                "get_status" => {
                    send_to_chrome(&serde_json::json!({
                        "type": "status_response",
                        "native_host_version": NATIVE_HOST_VERSION
                    }));
                }
                _ => {
                    self.forward_to_mcp_clients(&data).await;
                }
            }
        } else {
            self.forward_to_mcp_clients(&data).await;
        }

        Ok(())
    }

    /// 转发消息到所有 MCP 客户端 (Unix)
    #[cfg(unix)]
    async fn forward_to_mcp_clients(&self, data: &serde_json::Value) {
        let mut clients = self.mcp_clients.lock().await;
        if clients.is_empty() {
            return;
        }

        log_message(&format!("Forwarding to {} MCP clients", clients.len()));

        let json = serde_json::to_vec(data).unwrap_or_default();
        let mut header = [0u8; 4];
        header.copy_from_slice(&(json.len() as u32).to_le_bytes());

        let mut failed_ids = Vec::new();

        for (id, client) in clients.iter_mut() {
            if client.writer.write_all(&header).await.is_err()
                || client.writer.write_all(&json).await.is_err()
            {
                failed_ids.push(*id);
            }
        }

        for id in failed_ids {
            clients.remove(&id);
        }
    }

    /// 转发消息到所有 MCP 客户端 (Windows)
    #[cfg(windows)]
    async fn forward_to_mcp_clients(&self, data: &serde_json::Value) {
        let mut clients = self.mcp_clients.lock().await;
        if clients.is_empty() {
            return;
        }

        log_message(&format!("Forwarding to {} MCP clients", clients.len()));

        let json = serde_json::to_vec(data).unwrap_or_default();
        let mut header = [0u8; 4];
        header.copy_from_slice(&(json.len() as u32).to_le_bytes());

        let mut failed_ids = Vec::new();

        for (id, client) in clients.iter_mut() {
            let mut pipe = client.pipe.lock().await;
            if pipe.write_all(&header).await.is_err() || pipe.write_all(&json).await.is_err() {
                failed_ids.push(*id);
            }
        }

        for id in failed_ids {
            clients.remove(&id);
        }
    }

    /// 停止服务器 (Unix)
    #[cfg(unix)]
    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        if !*running {
            return;
        }
        *running = false;

        // 清理 socket 文件
        let socket_path = get_socket_path();
        let _ = std::fs::remove_file(&socket_path);

        // 关闭所有客户端
        let mut clients = self.mcp_clients.lock().await;
        clients.clear();

        log_message("Socket server stopped");
    }

    /// 停止服务器 (Windows)
    #[cfg(windows)]
    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        if !*running {
            return;
        }
        *running = false;

        // 关闭所有客户端
        let mut clients = self.mcp_clients.lock().await;
        clients.clear();

        log_message("Named pipe server stopped");
    }
}

impl Default for SocketServer {
    fn default() -> Self {
        Self::new()
    }
}

/// 日志输出到 stderr（Native Messaging 使用 stdout）
fn log_message(message: &str) {
    let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
    eprintln!("[{}] [Native Host] {}", timestamp, message);

    // 同时写入日志文件
    if let Some(home) = dirs::home_dir() {
        let log_file = home.join(".aster").join("native-host.log");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
        {
            let _ = writeln!(file, "[{}] {}", timestamp, message);
        }
    }
}

/// 向 Chrome 扩展发送消息（Native Messaging 协议）
fn send_to_chrome(message: &serde_json::Value) {
    let json_str = serde_json::to_string(message).unwrap_or_default();
    log_message(&format!(
        "Sending to Chrome: {}",
        json_str.get(..json_str.len().min(200)).unwrap_or(&json_str)
    ));

    let json = json_str.as_bytes();
    let mut header = [0u8; 4];
    header.copy_from_slice(&(json.len() as u32).to_le_bytes());

    let mut stdout = std::io::stdout().lock();
    let _ = stdout.write_all(&header);
    let _ = stdout.write_all(json);
    let _ = stdout.flush();
}

/// Native Message Reader - 从 stdin 读取 Native Messaging 消息
#[allow(dead_code)]
pub struct NativeMessageReader {
    buffer: Vec<u8>,
}

impl NativeMessageReader {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    /// 读取下一条消息
    pub fn read(&mut self) -> Option<String> {
        let mut stdin = std::io::stdin().lock();
        let mut header = [0u8; 4];

        if stdin.read_exact(&mut header).is_err() {
            return None;
        }

        let msg_len = u32::from_le_bytes(header);
        if msg_len == 0 || msg_len > MAX_MESSAGE_SIZE {
            log_message(&format!("Invalid message length: {}", msg_len));
            return None;
        }

        let mut msg_buf = vec![0u8; msg_len as usize];
        if stdin.read_exact(&mut msg_buf).is_err() {
            return None;
        }

        String::from_utf8(msg_buf).ok()
    }
}

impl Default for NativeMessageReader {
    fn default() -> Self {
        Self::new()
    }
}

/// 运行 Native Host 主循环
pub async fn run_native_host() -> Result<(), String> {
    log_message("Initializing Native Host...");

    let server = SocketServer::new();
    let mut reader = NativeMessageReader::new();

    // 启动 socket server（在后台）
    tokio::spawn(async move {
        let s = SocketServer::new();
        if let Err(e) = s.start().await {
            log_message(&format!("Socket server error: {}", e));
        }
    });

    // 从 Chrome 扩展读取消息
    log_message("Running in Native Messaging mode");
    while let Some(message) = reader.read() {
        if let Err(e) = server.handle_chrome_message(&message).await {
            log_message(&format!("Handle message error: {}", e));
        }
    }

    server.stop().await;
    Ok(())
}
