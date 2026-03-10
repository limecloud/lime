//! SSH 远程连接模块
//!
//! 提供 SSH 远程连接功能，支持连接字符串解析、认证、远程 Shell 进程管理。
//!
//! ## 功能
//! - SSH 连接字符串解析（user@host:port 格式）
//! - 连接状态管理（init→connecting→connected/error）
//! - 多种认证方式（公钥、密码、键盘交互）
//! - 远程 PTY 创建和数据转发
//! - SSH 配置文件解析
//! - known_hosts 验证
//!
//! ## Requirements
//! - 4.1: 解析连接字符串
//! - 4.2: 创建远程 PTY 会话
//! - 4.3-4.6: 多种认证方式
//! - 4.7: ProxyJump 支持
//! - 4.8-4.9: known_hosts 验证
//! - 4.10: 连接断开处理
//! - 4.11: 终端大小同步
//! - 4.12: SSH 配置文件解析
//! - 7.1-7.7: 连接状态管理

use std::collections::HashMap;
use std::fmt;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicI64, Ordering};
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use ssh2::{KeyboardInteractivePrompt as SshKeyboardInteractivePrompt, Session};

use crate::emit_helper;
use crate::emitter::TerminalEventEmit;
use crate::error::TerminalError;

/// 默认 SSH 端口
pub const DEFAULT_SSH_PORT: u16 = 22;

/// 最大 ProxyJump 深度
pub const MAX_PROXY_JUMP_DEPTH: usize = 10;

// ============================================================================
// SSH 连接选项
// ============================================================================

/// SSH 连接选项
///
/// 存储解析后的 SSH 连接参数。
///
/// ## 格式支持
/// - `host` - 仅主机名
/// - `user@host` - 用户名和主机名
/// - `user@host:port` - 完整格式
/// - `host:port` - 主机名和端口
///
/// _Requirements: 4.1_
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SSHOpts {
    /// SSH 主机名或 IP 地址
    pub ssh_host: String,
    /// SSH 用户名（可选，默认使用当前用户）
    pub ssh_user: Option<String>,
    /// SSH 端口（可选，默认 22）
    pub ssh_port: Option<u16>,
}

impl SSHOpts {
    /// 创建新的 SSH 选项
    pub fn new(host: impl Into<String>) -> Self {
        Self {
            ssh_host: host.into(),
            ssh_user: None,
            ssh_port: None,
        }
    }

    /// 设置用户名
    pub fn with_user(mut self, user: impl Into<String>) -> Self {
        self.ssh_user = Some(user.into());
        self
    }

    /// 设置端口
    pub fn with_port(mut self, port: u16) -> Self {
        self.ssh_port = Some(port);
        self
    }

    /// 从连接字符串解析 SSH 选项
    ///
    /// 支持以下格式：
    /// - `host`
    /// - `user@host`
    /// - `user@host:port`
    /// - `host:port`
    ///
    /// # 参数
    /// - `conn_str`: 连接字符串
    ///
    /// # 返回
    /// - `Ok(SSHOpts)`: 解析成功
    /// - `Err(TerminalError)`: 解析失败
    ///
    /// _Requirements: 4.1_
    pub fn parse(conn_str: &str) -> Result<Self, TerminalError> {
        let conn_str = conn_str.trim();

        if conn_str.is_empty() {
            return Err(TerminalError::SSHConnectionFailed(
                "连接字符串不能为空".to_string(),
            ));
        }

        // 移除可能的 ssh:// 前缀
        let conn_str = conn_str.strip_prefix("ssh://").unwrap_or(conn_str);

        let (user_part, host_port_part) = if let Some(at_pos) = conn_str.rfind('@') {
            let user = &conn_str[..at_pos];
            let host_port = &conn_str[at_pos + 1..];
            (Some(user), host_port)
        } else {
            (None, conn_str)
        };

        // 解析主机和端口
        let (host, port) = Self::parse_host_port(host_port_part)?;

        // 验证主机名
        if host.is_empty() {
            return Err(TerminalError::SSHConnectionFailed(
                "主机名不能为空".to_string(),
            ));
        }

        Ok(Self {
            ssh_host: host,
            ssh_user: user_part.map(|s| s.to_string()),
            ssh_port: port,
        })
    }

    /// 解析主机和端口部分
    ///
    /// 支持 IPv6 地址格式：`[::1]:22`
    fn parse_host_port(host_port: &str) -> Result<(String, Option<u16>), TerminalError> {
        // 检查是否是 IPv6 地址格式 [host]:port
        if host_port.starts_with('[') {
            if let Some(bracket_end) = host_port.find(']') {
                let host = &host_port[1..bracket_end];
                let remaining = &host_port[bracket_end + 1..];

                let port = if let Some(port_str) = remaining.strip_prefix(':') {
                    Some(Self::parse_port(port_str)?)
                } else if remaining.is_empty() {
                    None
                } else {
                    return Err(TerminalError::SSHConnectionFailed(format!(
                        "无效的 IPv6 地址格式: {host_port}"
                    )));
                };

                return Ok((host.to_string(), port));
            } else {
                return Err(TerminalError::SSHConnectionFailed(format!(
                    "无效的 IPv6 地址格式，缺少 ']': {host_port}"
                )));
            }
        }

        // 普通格式 host:port 或 host
        if let Some(colon_pos) = host_port.rfind(':') {
            let host = &host_port[..colon_pos];
            let port_str = &host_port[colon_pos + 1..];

            // 检查是否可能是 IPv6 地址（包含多个冒号）
            if host.contains(':') {
                // 这是一个没有方括号的 IPv6 地址，整个字符串都是主机名
                return Ok((host_port.to_string(), None));
            }

            let port = Self::parse_port(port_str)?;
            Ok((host.to_string(), Some(port)))
        } else {
            Ok((host_port.to_string(), None))
        }
    }

    /// 解析端口号
    fn parse_port(port_str: &str) -> Result<u16, TerminalError> {
        port_str
            .parse::<u16>()
            .map_err(|_| TerminalError::SSHConnectionFailed(format!("无效的端口号: {port_str}")))
    }

    /// 获取有效端口（如果未指定则返回默认端口）
    pub fn effective_port(&self) -> u16 {
        self.ssh_port.unwrap_or(DEFAULT_SSH_PORT)
    }

    /// 获取有效用户名（如果未指定则返回当前用户）
    pub fn effective_user(&self) -> String {
        self.ssh_user.clone().unwrap_or_else(|| {
            std::env::var("USER")
                .or_else(|_| std::env::var("USERNAME"))
                .unwrap_or_else(|_| "root".to_string())
        })
    }

    /// 转换为连接字符串
    ///
    /// 生成标准化的连接字符串格式。
    ///
    /// _Requirements: 4.1 (Round-Trip)_
    pub fn to_connection_string(&self) -> String {
        let mut result = String::new();

        if let Some(ref user) = self.ssh_user {
            result.push_str(user);
            result.push('@');
        }

        // 检查是否需要用方括号包裹 IPv6 地址
        if self.ssh_host.contains(':') && !self.ssh_host.starts_with('[') {
            result.push('[');
            result.push_str(&self.ssh_host);
            result.push(']');
        } else {
            result.push_str(&self.ssh_host);
        }

        if let Some(port) = self.ssh_port {
            result.push(':');
            result.push_str(&port.to_string());
        }

        result
    }
}

impl fmt::Display for SSHOpts {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_connection_string())
    }
}

impl std::str::FromStr for SSHOpts {
    type Err = TerminalError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

// ============================================================================
// 连接状态
// ============================================================================

/// 连接状态枚举
///
/// 表示 SSH 连接的当前状态。
///
/// _Requirements: 7.2_
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    /// 初始状态
    Init,
    /// 正在连接
    Connecting,
    /// 已连接
    Connected,
    /// 已断开
    Disconnected,
    /// 错误状态
    Error,
}

impl Default for ConnectionState {
    fn default() -> Self {
        Self::Init
    }
}

impl fmt::Display for ConnectionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Init => write!(f, "init"),
            Self::Connecting => write!(f, "connecting"),
            Self::Connected => write!(f, "connected"),
            Self::Disconnected => write!(f, "disconnected"),
            Self::Error => write!(f, "error"),
        }
    }
}

impl ConnectionState {
    /// 检查状态转换是否有效
    ///
    /// 有效的状态转换：
    /// - init → connecting
    /// - connecting → connected
    /// - connecting → error
    /// - connected → disconnected
    /// - disconnected → connecting
    /// - error → connecting
    ///
    /// _Requirements: 7.2_
    pub fn can_transition_to(&self, new_state: ConnectionState) -> bool {
        matches!(
            (self, new_state),
            (Self::Init, Self::Connecting)
                | (Self::Connecting, Self::Connected)
                | (Self::Connecting, Self::Error)
                | (Self::Connected, Self::Disconnected)
                | (Self::Disconnected, Self::Connecting)
                | (Self::Error, Self::Connecting)
        )
    }
}

/// 连接状态详情
///
/// 包含连接的完整状态信息，用于前端显示。
///
/// _Requirements: 7.1_
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnStatus {
    /// 状态字符串
    pub status: String,
    /// 是否已连接
    pub connected: bool,
    /// 连接名称
    pub connection: String,
    /// 是否曾经连接成功
    pub has_connected: bool,
    /// 活跃连接数
    pub active_conn_num: i32,
    /// 错误信息
    pub error: Option<String>,
    /// wsh 是否启用
    pub wsh_enabled: bool,
    /// wsh 错误信息
    pub wsh_error: Option<String>,
    /// 不使用 wsh 的原因
    pub no_wsh_reason: Option<String>,
    /// wsh 版本
    pub wsh_version: Option<String>,
}

impl Default for ConnStatus {
    fn default() -> Self {
        Self {
            status: "init".to_string(),
            connected: false,
            connection: String::new(),
            has_connected: false,
            active_conn_num: 0,
            error: None,
            wsh_enabled: false,
            wsh_error: None,
            no_wsh_reason: None,
            wsh_version: None,
        }
    }
}

impl ConnStatus {
    /// 创建新的连接状态
    pub fn new(connection: impl Into<String>) -> Self {
        Self {
            connection: connection.into(),
            ..Default::default()
        }
    }

    /// 设置为连接中状态
    pub fn set_connecting(&mut self) {
        self.status = "connecting".to_string();
        self.connected = false;
        self.error = None;
    }

    /// 设置为已连接状态
    pub fn set_connected(&mut self) {
        self.status = "connected".to_string();
        self.connected = true;
        self.has_connected = true;
        self.error = None;
    }

    /// 设置为已断开状态
    pub fn set_disconnected(&mut self) {
        self.status = "disconnected".to_string();
        self.connected = false;
    }

    /// 设置为错误状态
    pub fn set_error(&mut self, error: impl Into<String>) {
        self.status = "error".to_string();
        self.connected = false;
        self.error = Some(error.into());
    }
}

// ============================================================================
// SSH 认证选项
// ============================================================================

/// SSH 认证方式
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SSHAuthMethod {
    /// 公钥认证
    PublicKey {
        /// 私钥文件路径
        key_path: PathBuf,
        /// 密钥密码（可选）
        passphrase: Option<String>,
    },
    /// SSH Agent 认证
    Agent,
    /// 密码认证
    Password(String),
    /// 键盘交互认证
    KeyboardInteractive,
}

/// SSH 连接关键字配置
///
/// 从 SSH 配置文件或用户输入解析的连接参数。
///
/// _Requirements: 4.7, 4.12_
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConnKeywords {
    /// 主机名（HostName）
    pub host: Option<String>,
    /// 用户名（User）
    pub user: Option<String>,
    /// 端口（Port）
    pub port: Option<u16>,
    /// 身份文件路径列表（IdentityFile）
    pub identity_file: Option<Vec<String>>,
    /// ProxyJump 配置（跳板机）
    pub proxy_jump: Option<String>,
    /// ProxyCommand 配置
    pub proxy_command: Option<String>,
    /// 是否批处理模式（BatchMode）
    pub batch_mode: Option<bool>,
    /// 公钥认证（PubkeyAuthentication）
    pub pubkey_authentication: Option<bool>,
    /// 密码认证（PasswordAuthentication）
    pub password_authentication: Option<bool>,
    /// 键盘交互认证（KbdInteractiveAuthentication）
    pub kbd_interactive_authentication: Option<bool>,
    /// 首选认证方式（PreferredAuthentications）
    pub preferred_authentications: Option<Vec<String>>,
    /// 严格主机密钥检查（StrictHostKeyChecking）
    pub strict_host_key_checking: Option<String>,
    /// 用户 known_hosts 文件（UserKnownHostsFile）
    pub user_known_hosts_file: Option<String>,
    /// 连接超时（ConnectTimeout）
    pub connect_timeout: Option<u32>,
    /// 服务器存活检测最大次数（ServerAliveCountMax）
    pub server_alive_count_max: Option<u32>,
    /// 服务器存活检测间隔（ServerAliveInterval）
    pub server_alive_interval: Option<u32>,
    /// 转发 Agent（ForwardAgent）
    pub forward_agent: Option<bool>,
    /// 压缩（Compression）
    pub compression: Option<bool>,
    /// 本地端口转发（LocalForward）
    pub local_forward: Option<Vec<String>>,
    /// 远程端口转发（RemoteForward）
    pub remote_forward: Option<Vec<String>>,
    /// 动态端口转发（DynamicForward）
    pub dynamic_forward: Option<Vec<String>>,
    /// 请求 TTY（RequestTTY）
    pub request_tty: Option<String>,
    /// 远程命令（RemoteCommand）
    pub remote_command: Option<String>,
    /// 发送环境变量（SendEnv）
    pub send_env: Option<Vec<String>>,
    /// 设置环境变量（SetEnv）
    pub set_env: Option<Vec<String>>,
}

// ============================================================================
// 主机密钥验证
// ============================================================================

/// 主机密钥验证结果
///
/// _Requirements: 4.8, 4.9_
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HostKeyVerification {
    /// 验证成功（密钥匹配）
    Verified,
    /// 主机密钥未知（首次连接）
    Unknown {
        host: String,
        key_type: String,
        fingerprint: String,
    },
    /// 主机密钥不匹配（可能的中间人攻击）
    Mismatch {
        host: String,
        key_type: String,
        fingerprint: String,
    },
}

/// known_hosts 检查结果
#[derive(Debug)]
enum KnownHostsCheckResult {
    /// 密钥匹配
    Match,
    /// 未找到主机
    NotFound,
    /// 密钥不匹配
    Mismatch,
    /// 检查错误
    Error(String),
}

/// 键盘交互认证提示处理器
///
/// 实现 ssh2 的 KeyboardInteractivePrompt trait
struct KeyboardInteractivePrompt;

impl SshKeyboardInteractivePrompt for KeyboardInteractivePrompt {
    fn prompt<'a>(
        &mut self,
        _username: &str,
        _instructions: &str,
        prompts: &[ssh2::Prompt<'a>],
    ) -> Vec<String> {
        // 对于每个提示，返回空字符串
        // 完整实现需要 UI 回调来获取用户输入
        tracing::debug!("[KeyboardInteractivePrompt] 收到 {} 个提示", prompts.len());
        prompts.iter().map(|_| String::new()).collect()
    }
}

// ============================================================================
// SSH 连接管理器
// ============================================================================

/// SSH 连接管理器
///
/// 管理单个 SSH 连接的生命周期，包括连接、认证、断开和重连。
///
/// _Requirements: 4.10, 7.1-7.7_
pub struct SSHConn {
    /// 连接选项
    opts: SSHOpts,
    /// 当前状态
    state: RwLock<ConnectionState>,
    /// SSH 会话
    session: RwLock<Option<Session>>,
    /// TCP 连接（需要保持活跃）
    tcp_stream: RwLock<Option<TcpStream>>,
    /// wsh 是否启用
    wsh_enabled: AtomicBool,
    /// 错误信息
    error: RwLock<Option<String>>,
    /// 上次连接时间（Unix 时间戳）
    last_connect_time: AtomicI64,
    /// 活跃连接数
    active_conn_num: AtomicI32,
    /// 是否曾经连接成功
    has_connected: AtomicBool,
    /// wsh 版本
    wsh_version: RwLock<Option<String>>,
    /// wsh 错误
    wsh_error: RwLock<Option<String>>,
    /// 不使用 wsh 的原因
    no_wsh_reason: RwLock<Option<String>>,
    /// 事件发射器（用于事件广播）
    app_handle: RwLock<Option<Arc<dyn TerminalEventEmit>>>,
}

impl SSHConn {
    /// 创建新的 SSH 连接管理器
    pub fn new(opts: SSHOpts) -> Self {
        Self {
            opts,
            state: RwLock::new(ConnectionState::Init),
            session: RwLock::new(None),
            tcp_stream: RwLock::new(None),
            wsh_enabled: AtomicBool::new(false),
            error: RwLock::new(None),
            last_connect_time: AtomicI64::new(0),
            active_conn_num: AtomicI32::new(0),
            has_connected: AtomicBool::new(false),
            wsh_version: RwLock::new(None),
            wsh_error: RwLock::new(None),
            no_wsh_reason: RwLock::new(None),
            app_handle: RwLock::new(None),
        }
    }

    /// 创建带有事件发射器的 SSH 连接管理器
    ///
    /// 启用事件广播功能。
    pub fn with_app_handle(opts: SSHOpts, app_handle: impl TerminalEventEmit) -> Self {
        let conn = Self::new(opts);
        *conn.app_handle.write() = Some(Arc::new(app_handle));
        conn
    }

    /// 设置事件发射器
    pub fn set_app_handle(&self, app_handle: impl TerminalEventEmit) {
        *self.app_handle.write() = Some(Arc::new(app_handle));
    }

    /// 广播连接状态变更事件
    ///
    /// _Requirements: 7.3_
    fn broadcast_conn_change(&self) {
        use crate::events::{event_names, ConnChangeEvent};

        if let Some(ref app_handle) = *self.app_handle.read() {
            let status = self.derive_conn_status();
            let event = ConnChangeEvent {
                connection: self.opts.to_connection_string(),
                status,
            };

            if let Err(e) = emit_helper::emit(app_handle.as_ref(), event_names::CONN_CHANGE, &event)
            {
                tracing::warn!("[SSHConn] 广播连接状态变更事件失败: {}", e);
            }
        }
    }

    /// 从连接字符串创建
    pub fn from_connection_string(conn_str: &str) -> Result<Self, TerminalError> {
        let opts = SSHOpts::parse(conn_str)?;
        Ok(Self::new(opts))
    }

    /// 获取连接选项
    pub fn opts(&self) -> &SSHOpts {
        &self.opts
    }

    /// 获取当前状态
    pub fn state(&self) -> ConnectionState {
        *self.state.read()
    }

    /// 设置状态
    fn set_state(&self, new_state: ConnectionState) {
        let mut state = self.state.write();
        *state = new_state;
    }

    /// 获取错误信息
    pub fn error(&self) -> Option<String> {
        self.error.read().clone()
    }

    /// 设置错误信息
    fn set_error(&self, error: Option<String>) {
        let mut err = self.error.write();
        *err = error;
    }

    /// 检查是否已连接
    pub fn is_connected(&self) -> bool {
        self.state() == ConnectionState::Connected
    }

    /// 获取 SSH 会话
    pub fn get_session(&self) -> Option<Session> {
        self.session.read().clone()
    }

    /// 派生连接状态
    ///
    /// 生成用于前端显示的连接状态详情。
    ///
    /// _Requirements: 7.1_
    pub fn derive_conn_status(&self) -> ConnStatus {
        ConnStatus {
            status: self.state().to_string(),
            connected: self.is_connected(),
            connection: self.opts.to_connection_string(),
            has_connected: self.has_connected.load(Ordering::SeqCst),
            active_conn_num: self.active_conn_num.load(Ordering::SeqCst),
            error: self.error(),
            wsh_enabled: self.wsh_enabled.load(Ordering::SeqCst),
            wsh_error: self.wsh_error.read().clone(),
            no_wsh_reason: self.no_wsh_reason.read().clone(),
            wsh_version: self.wsh_version.read().clone(),
        }
    }

    /// 连接到远程服务器
    ///
    /// _Requirements: 4.10, 7.2_
    pub async fn connect(&self, _conn_flags: &ConnKeywords) -> Result<(), TerminalError> {
        // 检查状态转换
        let current_state = self.state();
        if !current_state.can_transition_to(ConnectionState::Connecting) {
            return Err(TerminalError::SSHConnectionFailed(format!(
                "无法从 {current_state} 状态开始连接"
            )));
        }

        self.set_state(ConnectionState::Connecting);
        self.set_error(None);
        self.broadcast_conn_change();

        // 构建连接地址
        let addr = format!("{}:{}", self.opts.ssh_host, self.opts.effective_port());
        tracing::info!("[SSHConn] 正在连接到 {}", addr);

        // 建立 TCP 连接
        let tcp = match TcpStream::connect(&addr) {
            Ok(stream) => stream,
            Err(e) => {
                let error_msg = format!("TCP 连接失败: {e}");
                tracing::error!("[SSHConn] {}", error_msg);
                self.set_state(ConnectionState::Error);
                self.set_error(Some(error_msg.clone()));
                self.broadcast_conn_change();
                return Err(TerminalError::SSHConnectionFailed(error_msg));
            }
        };

        // 创建 SSH 会话
        let mut session = Session::new().map_err(|e| {
            let error_msg = format!("创建 SSH 会话失败: {e}");
            self.set_state(ConnectionState::Error);
            self.set_error(Some(error_msg.clone()));
            self.broadcast_conn_change();
            TerminalError::SSHConnectionFailed(error_msg)
        })?;

        // 设置 TCP 流
        session.set_tcp_stream(tcp.try_clone().map_err(|e| {
            let error_msg = format!("克隆 TCP 流失败: {e}");
            self.set_state(ConnectionState::Error);
            self.set_error(Some(error_msg.clone()));
            self.broadcast_conn_change();
            TerminalError::SSHConnectionFailed(error_msg)
        })?);

        // 执行 SSH 握手
        session.handshake().map_err(|e| {
            let error_msg = format!("SSH 握手失败: {e}");
            tracing::error!("[SSHConn] {}", error_msg);
            self.set_state(ConnectionState::Error);
            self.set_error(Some(error_msg.clone()));
            self.broadcast_conn_change();
            TerminalError::SSHConnectionFailed(error_msg)
        })?;

        tracing::info!("[SSHConn] SSH 握手成功");

        // 保存会话和 TCP 流
        {
            let mut sess = self.session.write();
            *sess = Some(session);
        }
        {
            let mut stream = self.tcp_stream.write();
            *stream = Some(tcp);
        }

        // 注意：认证将在 authenticate 方法中完成
        // 这里只完成连接建立

        Ok(())
    }

    /// 执行认证
    ///
    /// _Requirements: 4.3, 4.4, 4.5, 4.6_
    pub async fn authenticate(&self, auth_methods: &[SSHAuthMethod]) -> Result<(), TerminalError> {
        let session = self.session.read();
        let session = session
            .as_ref()
            .ok_or_else(|| TerminalError::SSHConnectionFailed("未建立 SSH 会话".to_string()))?;

        let username = self.opts.effective_user();
        tracing::info!("[SSHConn] 开始认证，用户: {}", username);

        for method in auth_methods {
            match self.try_auth(session, &username, method) {
                Ok(()) => {
                    tracing::info!("[SSHConn] 认证成功");
                    self.set_state(ConnectionState::Connected);
                    self.has_connected.store(true, Ordering::SeqCst);
                    self.last_connect_time
                        .store(chrono::Utc::now().timestamp(), Ordering::SeqCst);
                    self.active_conn_num.fetch_add(1, Ordering::SeqCst);
                    self.broadcast_conn_change();
                    return Ok(());
                }
                Err(e) => {
                    tracing::warn!("[SSHConn] 认证方式失败: {:?}, 错误: {}", method, e);
                    continue;
                }
            }
        }

        let error_msg = "所有认证方式均失败".to_string();
        self.set_state(ConnectionState::Error);
        self.set_error(Some(error_msg.clone()));
        self.broadcast_conn_change();
        Err(TerminalError::SSHAuthFailed(error_msg))
    }

    /// 尝试单个认证方式
    fn try_auth(
        &self,
        session: &Session,
        username: &str,
        method: &SSHAuthMethod,
    ) -> Result<(), TerminalError> {
        match method {
            SSHAuthMethod::PublicKey {
                key_path,
                passphrase,
            } => {
                tracing::debug!("[SSHConn] 尝试公钥认证: {:?}", key_path);
                session
                    .userauth_pubkey_file(username, None, key_path, passphrase.as_deref())
                    .map_err(|e| TerminalError::SSHAuthFailed(e.to_string()))?;
            }
            SSHAuthMethod::Agent => {
                tracing::debug!("[SSHConn] 尝试 SSH Agent 认证");
                let mut agent = session.agent().map_err(|e| {
                    TerminalError::SSHAuthFailed(format!("获取 SSH Agent 失败: {e}"))
                })?;
                agent.connect().map_err(|e| {
                    TerminalError::SSHAuthFailed(format!("连接 SSH Agent 失败: {e}"))
                })?;
                agent
                    .list_identities()
                    .map_err(|e| TerminalError::SSHAuthFailed(format!("列出身份失败: {e}")))?;

                let identities: Vec<_> = agent
                    .identities()
                    .map_err(|e| TerminalError::SSHAuthFailed(format!("获取身份列表失败: {e}")))?;

                for identity in identities {
                    if agent.userauth(username, &identity).is_ok() {
                        return Ok(());
                    }
                }
                return Err(TerminalError::SSHAuthFailed(
                    "SSH Agent 中没有有效的身份".to_string(),
                ));
            }
            SSHAuthMethod::Password(password) => {
                tracing::debug!("[SSHConn] 尝试密码认证");
                session
                    .userauth_password(username, password)
                    .map_err(|e| TerminalError::SSHAuthFailed(e.to_string()))?;
            }
            SSHAuthMethod::KeyboardInteractive => {
                tracing::debug!("[SSHConn] 尝试键盘交互认证");
                // 键盘交互认证 - 使用空响应尝试
                // 注意：完整的键盘交互认证需要 UI 回调，这里提供基础支持
                session
                    .userauth_keyboard_interactive(username, &mut KeyboardInteractivePrompt)
                    .map_err(|e| TerminalError::SSHAuthFailed(e.to_string()))?;
            }
        }

        if session.authenticated() {
            Ok(())
        } else {
            Err(TerminalError::SSHAuthFailed("认证未完成".to_string()))
        }
    }

    /// 验证远程主机密钥
    ///
    /// _Requirements: 4.8, 4.9_
    pub fn verify_host_key(&self) -> Result<HostKeyVerification, TerminalError> {
        let session = self.session.read();
        let session = session
            .as_ref()
            .ok_or_else(|| TerminalError::SSHConnectionFailed("未建立 SSH 会话".to_string()))?;

        // 获取远程主机密钥
        let (host_key, host_key_type) = session.host_key().ok_or_else(|| {
            TerminalError::HostKeyVerificationFailed("无法获取主机密钥".to_string())
        })?;

        let host_key_fingerprint = Self::compute_fingerprint(host_key);
        let host_key_type_str = match host_key_type {
            ssh2::HostKeyType::Rsa => "ssh-rsa",
            ssh2::HostKeyType::Dss => "ssh-dss",
            ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
            ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
            ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
            ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
            ssh2::HostKeyType::Unknown => "unknown",
        };

        // 检查 known_hosts
        let known_hosts_result = self.check_known_hosts(session, &self.opts.ssh_host, host_key);

        match known_hosts_result {
            KnownHostsCheckResult::Match => {
                tracing::info!("[SSHConn] 主机密钥验证成功");
                Ok(HostKeyVerification::Verified)
            }
            KnownHostsCheckResult::NotFound => {
                tracing::warn!("[SSHConn] 主机密钥未知: {}", self.opts.ssh_host);
                Ok(HostKeyVerification::Unknown {
                    host: self.opts.ssh_host.clone(),
                    key_type: host_key_type_str.to_string(),
                    fingerprint: host_key_fingerprint,
                })
            }
            KnownHostsCheckResult::Mismatch => {
                tracing::error!("[SSHConn] 主机密钥不匹配！可能存在中间人攻击");
                Ok(HostKeyVerification::Mismatch {
                    host: self.opts.ssh_host.clone(),
                    key_type: host_key_type_str.to_string(),
                    fingerprint: host_key_fingerprint,
                })
            }
            KnownHostsCheckResult::Error(e) => Err(TerminalError::HostKeyVerificationFailed(e)),
        }
    }

    /// 计算密钥指纹
    fn compute_fingerprint(key: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(key);
        let result = hasher.finalize();

        // 转换为 Base64 格式的指纹
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        format!("SHA256:{}", BASE64.encode(result))
    }

    /// 检查 known_hosts 文件
    fn check_known_hosts(
        &self,
        session: &Session,
        host: &str,
        host_key: &[u8],
    ) -> KnownHostsCheckResult {
        let mut known_hosts = match session.known_hosts() {
            Ok(kh) => kh,
            Err(e) => return KnownHostsCheckResult::Error(e.to_string()),
        };

        // 读取 known_hosts 文件
        if let Some(known_hosts_path) = Self::get_known_hosts_path() {
            if known_hosts_path.exists() {
                if let Err(e) =
                    known_hosts.read_file(&known_hosts_path, ssh2::KnownHostFileKind::OpenSSH)
                {
                    tracing::warn!("[SSHConn] 读取 known_hosts 失败: {}", e);
                    // 继续执行，视为未找到
                }
            }
        }

        // 检查主机密钥
        let port = self.opts.effective_port();
        match known_hosts.check_port(host, port, host_key) {
            ssh2::CheckResult::Match => KnownHostsCheckResult::Match,
            ssh2::CheckResult::NotFound => KnownHostsCheckResult::NotFound,
            ssh2::CheckResult::Mismatch => KnownHostsCheckResult::Mismatch,
            ssh2::CheckResult::Failure => {
                KnownHostsCheckResult::Error("known_hosts 检查失败".to_string())
            }
        }
    }

    /// 获取 known_hosts 文件路径
    fn get_known_hosts_path() -> Option<PathBuf> {
        dirs::home_dir().map(|home| home.join(".ssh").join("known_hosts"))
    }

    /// 添加主机密钥到 known_hosts
    ///
    /// _Requirements: 4.8_
    pub fn add_host_to_known_hosts(&self) -> Result<(), TerminalError> {
        let session = self.session.read();
        let session = session
            .as_ref()
            .ok_or_else(|| TerminalError::SSHConnectionFailed("未建立 SSH 会话".to_string()))?;

        let (host_key, host_key_type) = session.host_key().ok_or_else(|| {
            TerminalError::HostKeyVerificationFailed("无法获取主机密钥".to_string())
        })?;

        let mut known_hosts = session.known_hosts().map_err(|e| {
            TerminalError::HostKeyVerificationFailed(format!("获取 known_hosts 失败: {e}"))
        })?;

        // 读取现有的 known_hosts 文件
        let known_hosts_path = Self::get_known_hosts_path().ok_or_else(|| {
            TerminalError::HostKeyVerificationFailed("无法获取 known_hosts 路径".to_string())
        })?;

        if known_hosts_path.exists() {
            let _ = known_hosts.read_file(&known_hosts_path, ssh2::KnownHostFileKind::OpenSSH);
        }

        // 确定密钥类型
        let key_type = match host_key_type {
            ssh2::HostKeyType::Rsa => ssh2::KnownHostKeyFormat::SshRsa,
            ssh2::HostKeyType::Dss => ssh2::KnownHostKeyFormat::SshDss,
            ssh2::HostKeyType::Ecdsa256
            | ssh2::HostKeyType::Ecdsa384
            | ssh2::HostKeyType::Ecdsa521 => ssh2::KnownHostKeyFormat::SshRsa, // 使用 RSA 作为后备
            ssh2::HostKeyType::Ed25519 => ssh2::KnownHostKeyFormat::SshRsa, // 使用 RSA 作为后备
            ssh2::HostKeyType::Unknown => {
                return Err(TerminalError::HostKeyVerificationFailed(
                    "未知的密钥类型".to_string(),
                ));
            }
        };

        // 添加主机密钥
        let host_with_port = if self.opts.ssh_port.is_some() && self.opts.effective_port() != 22 {
            format!("[{}]:{}", self.opts.ssh_host, self.opts.effective_port())
        } else {
            self.opts.ssh_host.clone()
        };

        known_hosts
            .add(&host_with_port, host_key, "", key_type)
            .map_err(|e| {
                TerminalError::HostKeyVerificationFailed(format!("添加主机密钥失败: {e}"))
            })?;

        // 确保 .ssh 目录存在
        if let Some(ssh_dir) = known_hosts_path.parent() {
            if !ssh_dir.exists() {
                std::fs::create_dir_all(ssh_dir).map_err(|e| {
                    TerminalError::HostKeyVerificationFailed(format!("创建 .ssh 目录失败: {e}"))
                })?;
            }
        }

        // 写入 known_hosts 文件
        known_hosts
            .write_file(&known_hosts_path, ssh2::KnownHostFileKind::OpenSSH)
            .map_err(|e| {
                TerminalError::HostKeyVerificationFailed(format!("写入 known_hosts 失败: {e}"))
            })?;

        tracing::info!("[SSHConn] 已添加主机密钥到 known_hosts: {}", host_with_port);
        Ok(())
    }

    /// 断开连接
    ///
    /// _Requirements: 4.10_
    pub async fn close(&self) -> Result<(), TerminalError> {
        tracing::info!("[SSHConn] 断开连接: {}", self.opts);

        // 断开 SSH 会话
        {
            let mut session = self.session.write();
            if let Some(sess) = session.take() {
                let _ = sess.disconnect(None, "Connection closed", None);
            }
        }

        // 关闭 TCP 连接
        {
            let mut stream = self.tcp_stream.write();
            *stream = None;
        }

        self.set_state(ConnectionState::Disconnected);
        self.active_conn_num.fetch_sub(1, Ordering::SeqCst);
        self.broadcast_conn_change();

        Ok(())
    }

    /// 重新连接
    ///
    /// _Requirements: 7.5_
    pub async fn reconnect(&self, conn_flags: &ConnKeywords) -> Result<(), TerminalError> {
        tracing::info!("[SSHConn] 重新连接: {}", self.opts);

        // 先断开现有连接
        let _ = self.close().await;

        // 重置状态
        self.set_state(ConnectionState::Init);
        self.broadcast_conn_change();

        // 重新连接
        self.connect(conn_flags).await
    }

    /// 使用回调进行认证
    ///
    /// 支持交互式认证，通过回调获取用户输入。
    ///
    /// _Requirements: 4.3, 4.4, 4.5, 4.6_
    pub async fn authenticate_with_callback<C: SSHAuthCallback>(
        &self,
        auth_methods: &[SSHAuthMethod],
        callback: &C,
    ) -> Result<(), TerminalError> {
        let session = self.session.read();
        let session = session
            .as_ref()
            .ok_or_else(|| TerminalError::SSHConnectionFailed("未建立 SSH 会话".to_string()))?;

        let username = self.opts.effective_user();
        tracing::info!("[SSHConn] 开始认证（带回调），用户: {}", username);

        for method in auth_methods {
            match self.try_auth_with_callback(session, &username, method, callback) {
                Ok(()) => {
                    tracing::info!("[SSHConn] 认证成功");
                    // 释放读锁后再修改状态
                    self.set_state(ConnectionState::Connected);
                    self.has_connected.store(true, Ordering::SeqCst);
                    self.last_connect_time
                        .store(chrono::Utc::now().timestamp(), Ordering::SeqCst);
                    self.active_conn_num.fetch_add(1, Ordering::SeqCst);
                    self.broadcast_conn_change();
                    return Ok(());
                }
                Err(e) => {
                    tracing::warn!("[SSHConn] 认证方式失败: {:?}, 错误: {}", method, e);
                    continue;
                }
            }
        }

        let error_msg = "所有认证方式均失败".to_string();
        // 释放读锁后再修改状态
        self.set_state(ConnectionState::Error);
        self.set_error(Some(error_msg.clone()));
        self.broadcast_conn_change();
        Err(TerminalError::SSHAuthFailed(error_msg))
    }

    /// 尝试单个认证方式（带回调）
    fn try_auth_with_callback<C: SSHAuthCallback>(
        &self,
        session: &Session,
        username: &str,
        method: &SSHAuthMethod,
        callback: &C,
    ) -> Result<(), TerminalError> {
        match method {
            SSHAuthMethod::PublicKey {
                key_path,
                passphrase,
            } => {
                tracing::debug!("[SSHConn] 尝试公钥认证: {:?}", key_path);

                // 首先尝试不带密码
                let result =
                    session.userauth_pubkey_file(username, None, key_path, passphrase.as_deref());

                match result {
                    Ok(()) if session.authenticated() => return Ok(()),
                    Err(e) if e.code() == ssh2::ErrorCode::Session(-16) => {
                        // 密钥需要密码，通过回调请求
                        tracing::debug!("[SSHConn] 密钥需要密码: {:?}", key_path);
                        if let Some(pass) = callback.request_passphrase(key_path) {
                            session
                                .userauth_pubkey_file(username, None, key_path, Some(&pass))
                                .map_err(|e| TerminalError::SSHAuthFailed(e.to_string()))?;
                        } else {
                            return Err(TerminalError::SSHAuthFailed(
                                "用户取消输入密钥密码".to_string(),
                            ));
                        }
                    }
                    Err(e) => return Err(TerminalError::SSHAuthFailed(e.to_string())),
                    Ok(()) => {}
                }
            }
            SSHAuthMethod::Agent => {
                tracing::debug!("[SSHConn] 尝试 SSH Agent 认证");
                let mut agent = session.agent().map_err(|e| {
                    TerminalError::SSHAuthFailed(format!("获取 SSH Agent 失败: {e}"))
                })?;
                agent.connect().map_err(|e| {
                    TerminalError::SSHAuthFailed(format!("连接 SSH Agent 失败: {e}"))
                })?;
                agent
                    .list_identities()
                    .map_err(|e| TerminalError::SSHAuthFailed(format!("列出身份失败: {e}")))?;

                let identities: Vec<_> = agent
                    .identities()
                    .map_err(|e| TerminalError::SSHAuthFailed(format!("获取身份列表失败: {e}")))?;

                for identity in identities {
                    if agent.userauth(username, &identity).is_ok() && session.authenticated() {
                        return Ok(());
                    }
                }
                return Err(TerminalError::SSHAuthFailed(
                    "SSH Agent 中没有有效的身份".to_string(),
                ));
            }
            SSHAuthMethod::Password(password) => {
                tracing::debug!("[SSHConn] 尝试密码认证");

                let pwd = if password.is_empty() {
                    // 通过回调请求密码
                    callback
                        .request_password(username, &self.opts.ssh_host)
                        .ok_or_else(|| {
                            TerminalError::SSHAuthFailed("用户取消输入密码".to_string())
                        })?
                } else {
                    password.clone()
                };

                session
                    .userauth_password(username, &pwd)
                    .map_err(|e| TerminalError::SSHAuthFailed(e.to_string()))?;
            }
            SSHAuthMethod::KeyboardInteractive => {
                tracing::debug!("[SSHConn] 尝试键盘交互认证");

                // 创建带回调的键盘交互处理器
                let mut handler = CallbackKeyboardInteractivePrompt {
                    callback,
                    username: username.to_string(),
                };

                session
                    .userauth_keyboard_interactive(username, &mut handler)
                    .map_err(|e| TerminalError::SSHAuthFailed(e.to_string()))?;
            }
        }

        if session.authenticated() {
            Ok(())
        } else {
            Err(TerminalError::SSHAuthFailed("认证未完成".to_string()))
        }
    }

    /// 完整的连接和认证流程
    ///
    /// 包括连接、主机密钥验证和认证。
    ///
    /// _Requirements: 4.3-4.9_
    pub async fn connect_and_authenticate<C: SSHAuthCallback>(
        &self,
        conn_flags: &ConnKeywords,
        auth_methods: &[SSHAuthMethod],
        callback: &C,
    ) -> Result<(), TerminalError> {
        // 1. 建立连接
        self.connect(conn_flags).await?;

        // 2. 验证主机密钥
        match self.verify_host_key()? {
            HostKeyVerification::Verified => {
                tracing::info!("[SSHConn] 主机密钥已验证");
            }
            HostKeyVerification::Unknown {
                host,
                key_type,
                fingerprint,
            } => {
                tracing::warn!("[SSHConn] 主机密钥未知: {}", host);
                if callback.confirm_host_key(&host, &key_type, &fingerprint) {
                    self.add_host_to_known_hosts()?;
                } else {
                    let _ = self.close().await;
                    return Err(TerminalError::HostKeyVerificationFailed(
                        "用户拒绝接受主机密钥".to_string(),
                    ));
                }
            }
            HostKeyVerification::Mismatch {
                host,
                key_type,
                fingerprint,
            } => {
                tracing::error!("[SSHConn] 主机密钥不匹配: {}", host);
                if !callback.warn_host_key_mismatch(&host, &key_type, &fingerprint) {
                    let _ = self.close().await;
                    return Err(TerminalError::HostKeyVerificationFailed(
                        "主机密钥不匹配，可能存在中间人攻击".to_string(),
                    ));
                }
                // 用户选择继续，更新 known_hosts
                self.add_host_to_known_hosts()?;
            }
        }

        // 3. 执行认证
        self.authenticate_with_callback(auth_methods, callback)
            .await
    }
}

/// 带回调的键盘交互认证处理器
struct CallbackKeyboardInteractivePrompt<'a, C: SSHAuthCallback> {
    callback: &'a C,
    username: String,
}

impl<'a, C: SSHAuthCallback> SshKeyboardInteractivePrompt
    for CallbackKeyboardInteractivePrompt<'a, C>
{
    fn prompt<'b>(
        &mut self,
        _username: &str,
        instructions: &str,
        prompts: &[ssh2::Prompt<'b>],
    ) -> Vec<String> {
        let prompt_data: Vec<(String, bool)> = prompts
            .iter()
            .map(|p| (p.text.to_string(), p.echo))
            .collect();

        self.callback
            .handle_keyboard_interactive(&self.username, instructions, &prompt_data)
    }
}

// ============================================================================
// SSH 配置文件解析
// ============================================================================

/// SSH 配置条目
///
/// 存储单个 Host 块的配置信息。
#[derive(Debug, Clone, Default)]
pub struct SSHConfigEntry {
    /// Host 模式列表（一个 Host 行可以有多个模式）
    pub patterns: Vec<String>,
    /// 配置关键字
    pub keywords: ConnKeywords,
}

/// SSH 配置文件解析器
///
/// 解析 ~/.ssh/config 文件，支持：
/// - 多种配置选项（HostName, User, Port, IdentityFile 等）
/// - ProxyJump 跳板机配置
/// - 通配符模式匹配
/// - 配置合并（主机特定 + 通配符）
///
/// _Requirements: 4.7, 4.12_
pub struct SSHConfigParser;

impl SSHConfigParser {
    /// 获取默认 SSH 配置文件路径
    pub fn default_config_path() -> Option<PathBuf> {
        dirs::home_dir().map(|home| home.join(".ssh").join("config"))
    }

    /// 解析 SSH 配置文件
    ///
    /// _Requirements: 4.12_
    pub fn parse_config(path: &PathBuf) -> Result<HashMap<String, ConnKeywords>, TerminalError> {
        let content = std::fs::read_to_string(path).map_err(|e| {
            TerminalError::SSHConnectionFailed(format!("读取 SSH 配置文件失败: {e}"))
        })?;

        Self::parse_config_content(&content)
    }

    /// 解析配置内容
    pub fn parse_config_content(
        content: &str,
    ) -> Result<HashMap<String, ConnKeywords>, TerminalError> {
        let entries = Self::parse_config_entries(content)?;

        // 将条目转换为 HashMap，每个模式一个条目
        let mut hosts: HashMap<String, ConnKeywords> = HashMap::new();
        for entry in entries {
            for pattern in entry.patterns {
                hosts.insert(pattern, entry.keywords.clone());
            }
        }

        Ok(hosts)
    }

    /// 解析配置文件为条目列表
    ///
    /// 保留原始顺序，用于正确的配置合并。
    pub fn parse_config_entries(content: &str) -> Result<Vec<SSHConfigEntry>, TerminalError> {
        let mut entries: Vec<SSHConfigEntry> = Vec::new();
        let mut current_entry: Option<SSHConfigEntry> = None;

        for line in content.lines() {
            let line = line.trim();

            // 跳过空行和注释
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            // 解析键值对
            let (key, value) = Self::parse_line(line)?;

            if key.is_empty() {
                continue;
            }

            if key == "host" {
                // 保存之前的条目
                if let Some(entry) = current_entry.take() {
                    entries.push(entry);
                }

                // 解析 Host 模式（可以有多个，用空格分隔）
                let patterns: Vec<String> =
                    value.split_whitespace().map(|s| s.to_string()).collect();

                current_entry = Some(SSHConfigEntry {
                    patterns,
                    keywords: ConnKeywords::default(),
                });
            } else if key == "match" {
                // Match 块暂不支持，跳过
                if let Some(entry) = current_entry.take() {
                    entries.push(entry);
                }
                current_entry = None;
            } else if let Some(ref mut entry) = current_entry {
                Self::apply_keyword(&mut entry.keywords, &key, &value);
            }
        }

        // 保存最后一个条目
        if let Some(entry) = current_entry {
            entries.push(entry);
        }

        Ok(entries)
    }

    /// 解析单行配置
    ///
    /// 返回 (key, value) 元组，key 已转换为小写。
    fn parse_line(line: &str) -> Result<(String, String), TerminalError> {
        // SSH 配置文件支持两种格式：
        // 1. Key Value (空格分隔，优先)
        // 2. Key=Value (等号分隔，仅当没有空格时)

        let line = line.trim();

        // 首先尝试用空格分割（这是 SSH 配置的主要格式）
        if let Some(space_pos) = line.find(char::is_whitespace) {
            let key = line[..space_pos].trim().to_lowercase();
            let value = line[space_pos..].trim().to_string();

            // 如果 key 不包含 =，则使用空格分割的结果
            if !key.contains('=') {
                return Ok((key, Self::unquote(&value)));
            }
        }

        // 如果没有空格，或者 key 包含 =，尝试用 = 分割
        if let Some(eq_pos) = line.find('=') {
            let key = line[..eq_pos].trim().to_lowercase();
            let value = line[eq_pos + 1..].trim().to_string();
            return Ok((key, Self::unquote(&value)));
        }

        // 没有分隔符，返回空
        Ok((String::new(), String::new()))
    }

    /// 移除值两端的引号
    fn unquote(value: &str) -> String {
        let value = value.trim();
        if ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
            && value.len() >= 2
        {
            return value[1..value.len() - 1].to_string();
        }
        value.to_string()
    }

    /// 应用配置关键字
    fn apply_keyword(keywords: &mut ConnKeywords, key: &str, value: &str) {
        match key {
            "hostname" => keywords.host = Some(value.to_string()),
            "user" => keywords.user = Some(value.to_string()),
            "port" => keywords.port = value.parse().ok(),
            "identityfile" => {
                let path = Self::expand_path(value);
                if let Some(ref mut files) = keywords.identity_file {
                    files.push(path);
                } else {
                    keywords.identity_file = Some(vec![path]);
                }
            }
            "proxyjump" => keywords.proxy_jump = Some(value.to_string()),
            "proxycommand" => keywords.proxy_command = Some(value.to_string()),
            "batchmode" => keywords.batch_mode = Some(Self::parse_bool(value)),
            "pubkeyauthentication" => {
                keywords.pubkey_authentication = Some(Self::parse_bool(value))
            }
            "passwordauthentication" => {
                keywords.password_authentication = Some(Self::parse_bool(value))
            }
            "kbdinteractiveauthentication" | "challengeresponseauthentication" => {
                keywords.kbd_interactive_authentication = Some(Self::parse_bool(value))
            }
            "preferredauthentications" => {
                keywords.preferred_authentications =
                    Some(value.split(',').map(|s| s.trim().to_string()).collect());
            }
            "stricthostkeychecking" => {
                keywords.strict_host_key_checking = Some(value.to_string());
            }
            "userknownhostsfile" => {
                keywords.user_known_hosts_file = Some(Self::expand_path(value));
            }
            "connecttimeout" => {
                keywords.connect_timeout = value.parse().ok();
            }
            "serveralivecountmax" => {
                keywords.server_alive_count_max = value.parse().ok();
            }
            "serveraliveinterval" => {
                keywords.server_alive_interval = value.parse().ok();
            }
            "forwardagent" => {
                keywords.forward_agent = Some(Self::parse_bool(value));
            }
            "compression" => {
                keywords.compression = Some(Self::parse_bool(value));
            }
            "localforward" => {
                if let Some(ref mut forwards) = keywords.local_forward {
                    forwards.push(value.to_string());
                } else {
                    keywords.local_forward = Some(vec![value.to_string()]);
                }
            }
            "remoteforward" => {
                if let Some(ref mut forwards) = keywords.remote_forward {
                    forwards.push(value.to_string());
                } else {
                    keywords.remote_forward = Some(vec![value.to_string()]);
                }
            }
            "dynamicforward" => {
                if let Some(ref mut forwards) = keywords.dynamic_forward {
                    forwards.push(value.to_string());
                } else {
                    keywords.dynamic_forward = Some(vec![value.to_string()]);
                }
            }
            "requesttty" => {
                keywords.request_tty = Some(value.to_string());
            }
            "remotecommand" => {
                keywords.remote_command = Some(value.to_string());
            }
            "sendenv" => {
                if let Some(ref mut envs) = keywords.send_env {
                    envs.push(value.to_string());
                } else {
                    keywords.send_env = Some(vec![value.to_string()]);
                }
            }
            "setenv" => {
                if let Some(ref mut envs) = keywords.set_env {
                    envs.push(value.to_string());
                } else {
                    keywords.set_env = Some(vec![value.to_string()]);
                }
            }
            _ => {
                // 未知选项，忽略
                tracing::trace!("[SSHConfigParser] 忽略未知选项: {} = {}", key, value);
            }
        }
    }

    /// 解析布尔值
    fn parse_bool(value: &str) -> bool {
        matches!(value.to_lowercase().as_str(), "yes" | "true" | "1")
    }

    /// 展开路径中的 ~ 符号
    pub fn expand_path(path: &str) -> String {
        if path.starts_with("~/") {
            if let Some(home) = dirs::home_dir() {
                return home.join(&path[2..]).to_string_lossy().to_string();
            }
        } else if path == "~" {
            if let Some(home) = dirs::home_dir() {
                return home.to_string_lossy().to_string();
            }
        }
        path.to_string()
    }

    /// 获取主机配置
    ///
    /// 按照 SSH 配置文件的语义，合并所有匹配的配置块。
    /// 第一个匹配的值优先（first match wins）。
    ///
    /// _Requirements: 4.12_
    pub fn get_host_config(host: &str) -> Option<ConnKeywords> {
        let config_path = Self::default_config_path()?;
        if !config_path.exists() {
            return None;
        }

        Self::get_host_config_from_file(&config_path, host).ok()
    }

    /// 从指定文件获取主机配置
    pub fn get_host_config_from_file(
        path: &PathBuf,
        host: &str,
    ) -> Result<ConnKeywords, TerminalError> {
        let content = std::fs::read_to_string(path).map_err(|e| {
            TerminalError::SSHConnectionFailed(format!("读取 SSH 配置文件失败: {e}"))
        })?;

        Self::get_host_config_from_content(&content, host)
    }

    /// 从配置内容获取主机配置
    ///
    /// 按照 SSH 配置文件的语义合并配置：
    /// 1. 按顺序遍历所有 Host 块
    /// 2. 如果模式匹配，合并配置（first match wins）
    /// 3. 通配符 * 匹配所有主机
    pub fn get_host_config_from_content(
        content: &str,
        host: &str,
    ) -> Result<ConnKeywords, TerminalError> {
        let entries = Self::parse_config_entries(content)?;
        let mut merged = ConnKeywords::default();

        for entry in entries {
            // 检查是否有任何模式匹配
            let matches = entry.patterns.iter().any(|p| Self::match_pattern(p, host));

            if matches {
                // 合并配置（first match wins）
                Self::merge_keywords(&mut merged, &entry.keywords);
            }
        }

        Ok(merged)
    }

    /// 合并配置关键字
    ///
    /// 使用 "first match wins" 语义：只有当目标字段为 None 时才设置。
    fn merge_keywords(target: &mut ConnKeywords, source: &ConnKeywords) {
        if target.host.is_none() {
            target.host = source.host.clone();
        }
        if target.user.is_none() {
            target.user = source.user.clone();
        }
        if target.port.is_none() {
            target.port = source.port;
        }
        if target.identity_file.is_none() {
            target.identity_file = source.identity_file.clone();
        } else if let Some(ref source_files) = source.identity_file {
            // IdentityFile 是累加的
            if let Some(ref mut target_files) = target.identity_file {
                for file in source_files {
                    if !target_files.contains(file) {
                        target_files.push(file.clone());
                    }
                }
            }
        }
        if target.proxy_jump.is_none() {
            target.proxy_jump = source.proxy_jump.clone();
        }
        if target.proxy_command.is_none() {
            target.proxy_command = source.proxy_command.clone();
        }
        if target.batch_mode.is_none() {
            target.batch_mode = source.batch_mode;
        }
        if target.pubkey_authentication.is_none() {
            target.pubkey_authentication = source.pubkey_authentication;
        }
        if target.password_authentication.is_none() {
            target.password_authentication = source.password_authentication;
        }
        if target.kbd_interactive_authentication.is_none() {
            target.kbd_interactive_authentication = source.kbd_interactive_authentication;
        }
        if target.preferred_authentications.is_none() {
            target.preferred_authentications = source.preferred_authentications.clone();
        }
        if target.strict_host_key_checking.is_none() {
            target.strict_host_key_checking = source.strict_host_key_checking.clone();
        }
        if target.user_known_hosts_file.is_none() {
            target.user_known_hosts_file = source.user_known_hosts_file.clone();
        }
        if target.connect_timeout.is_none() {
            target.connect_timeout = source.connect_timeout;
        }
        if target.server_alive_count_max.is_none() {
            target.server_alive_count_max = source.server_alive_count_max;
        }
        if target.server_alive_interval.is_none() {
            target.server_alive_interval = source.server_alive_interval;
        }
        if target.forward_agent.is_none() {
            target.forward_agent = source.forward_agent;
        }
        if target.compression.is_none() {
            target.compression = source.compression;
        }
        if target.local_forward.is_none() {
            target.local_forward = source.local_forward.clone();
        }
        if target.remote_forward.is_none() {
            target.remote_forward = source.remote_forward.clone();
        }
        if target.dynamic_forward.is_none() {
            target.dynamic_forward = source.dynamic_forward.clone();
        }
        if target.request_tty.is_none() {
            target.request_tty = source.request_tty.clone();
        }
        if target.remote_command.is_none() {
            target.remote_command = source.remote_command.clone();
        }
        if target.send_env.is_none() {
            target.send_env = source.send_env.clone();
        }
        if target.set_env.is_none() {
            target.set_env = source.set_env.clone();
        }
    }

    /// 通配符模式匹配
    ///
    /// 支持以下模式：
    /// - `*` - 匹配所有
    /// - `*.example.com` - 后缀匹配
    /// - `server*` - 前缀匹配
    /// - `!pattern` - 否定匹配（排除）
    /// - `?` - 匹配单个字符
    pub fn match_pattern(pattern: &str, host: &str) -> bool {
        // 处理否定模式
        if let Some(negated) = pattern.strip_prefix('!') {
            return !Self::match_pattern_inner(negated, host);
        }

        Self::match_pattern_inner(pattern, host)
    }

    /// 内部模式匹配实现
    fn match_pattern_inner(pattern: &str, host: &str) -> bool {
        // 精确匹配
        if pattern == host {
            return true;
        }

        // 全匹配通配符
        if pattern == "*" {
            return true;
        }

        // 使用简单的通配符匹配
        Self::glob_match(pattern, host)
    }

    /// 简单的 glob 模式匹配
    ///
    /// 支持 * 和 ? 通配符。
    fn glob_match(pattern: &str, text: &str) -> bool {
        let pattern_chars: Vec<char> = pattern.chars().collect();
        let text_chars: Vec<char> = text.chars().collect();

        Self::glob_match_recursive(&pattern_chars, &text_chars, 0, 0)
    }

    /// 递归 glob 匹配
    fn glob_match_recursive(pattern: &[char], text: &[char], p_idx: usize, t_idx: usize) -> bool {
        // 如果模式和文本都已处理完，匹配成功
        if p_idx == pattern.len() && t_idx == text.len() {
            return true;
        }

        // 如果模式已处理完但文本还有剩余，匹配失败
        if p_idx == pattern.len() {
            return false;
        }

        let p_char = pattern[p_idx];

        match p_char {
            '*' => {
                // * 可以匹配零个或多个字符
                // 尝试匹配零个字符
                if Self::glob_match_recursive(pattern, text, p_idx + 1, t_idx) {
                    return true;
                }
                // 尝试匹配一个或多个字符
                if t_idx < text.len() {
                    return Self::glob_match_recursive(pattern, text, p_idx, t_idx + 1);
                }
                false
            }
            '?' => {
                // ? 匹配单个字符
                if t_idx < text.len() {
                    Self::glob_match_recursive(pattern, text, p_idx + 1, t_idx + 1)
                } else {
                    false
                }
            }
            _ => {
                // 普通字符，必须精确匹配
                if t_idx < text.len() && p_char == text[t_idx] {
                    Self::glob_match_recursive(pattern, text, p_idx + 1, t_idx + 1)
                } else {
                    false
                }
            }
        }
    }

    /// 解析 ProxyJump 链
    ///
    /// ProxyJump 可以是逗号分隔的跳板机列表。
    ///
    /// _Requirements: 4.7_
    pub fn parse_proxy_jump_chain(proxy_jump: &str) -> Vec<String> {
        if proxy_jump.is_empty() || proxy_jump.to_lowercase() == "none" {
            return Vec::new();
        }

        proxy_jump
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }

    /// 解析 ProxyJump 主机
    ///
    /// 支持格式：
    /// - `host`
    /// - `user@host`
    /// - `user@host:port`
    ///
    /// _Requirements: 4.7_
    pub fn parse_proxy_jump_host(jump_host: &str) -> Result<SSHOpts, TerminalError> {
        SSHOpts::parse(jump_host)
    }

    /// 获取完整的 ProxyJump 链配置
    ///
    /// 递归解析每个跳板机的配置。
    ///
    /// _Requirements: 4.7_
    pub fn resolve_proxy_jump_chain(
        proxy_jump: &str,
        depth: usize,
    ) -> Result<Vec<(SSHOpts, ConnKeywords)>, TerminalError> {
        if depth > MAX_PROXY_JUMP_DEPTH {
            return Err(TerminalError::SSHConnectionFailed(format!(
                "ProxyJump 链深度超过最大限制 {MAX_PROXY_JUMP_DEPTH}"
            )));
        }

        let jump_hosts = Self::parse_proxy_jump_chain(proxy_jump);
        let mut chain = Vec::new();

        for jump_host in jump_hosts {
            let opts = Self::parse_proxy_jump_host(&jump_host)?;

            // 获取跳板机的配置
            let config = Self::get_host_config(&opts.ssh_host).unwrap_or_default();

            // 如果跳板机也有 ProxyJump，递归解析
            if let Some(ref nested_jump) = config.proxy_jump {
                if nested_jump.to_lowercase() != "none" {
                    let nested_chain = Self::resolve_proxy_jump_chain(nested_jump, depth + 1)?;
                    chain.extend(nested_chain);
                }
            }

            chain.push((opts, config));
        }

        Ok(chain)
    }

    /// 将配置转换为连接字符串
    ///
    /// 用于 Round-Trip 测试。
    pub fn config_to_connection_string(config: &ConnKeywords, alias: &str) -> String {
        let mut result = String::new();

        // 使用 HostName 或别名作为主机
        let host = config.host.as_deref().unwrap_or(alias);

        // 添加用户
        if let Some(ref user) = config.user {
            result.push_str(user);
            result.push('@');
        }

        result.push_str(host);

        // 添加端口
        if let Some(port) = config.port {
            result.push(':');
            result.push_str(&port.to_string());
        }

        result
    }
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 获取默认身份文件列表
pub fn get_default_identity_files() -> Vec<PathBuf> {
    let mut files = Vec::new();

    if let Some(home) = dirs::home_dir() {
        let ssh_dir = home.join(".ssh");

        // 按优先级排序的默认密钥文件
        let default_keys = ["id_ed25519", "id_ecdsa", "id_rsa", "id_dsa"];

        for key in default_keys {
            let key_path = ssh_dir.join(key);
            if key_path.exists() {
                files.push(key_path);
            }
        }
    }

    files
}

/// 构建默认认证方式列表
///
/// 根据配置和可用资源构建认证方式列表。
/// 优先级：SSH Agent > 公钥 > 键盘交互 > 密码
///
/// _Requirements: 4.3, 4.4, 4.5, 4.6_
pub fn build_default_auth_methods(
    conn_keywords: &ConnKeywords,
    password: Option<String>,
) -> Vec<SSHAuthMethod> {
    let mut methods = Vec::new();

    // 检查是否禁用了某些认证方式
    let pubkey_enabled = conn_keywords.pubkey_authentication.unwrap_or(true);
    let password_enabled = conn_keywords.password_authentication.unwrap_or(true);
    let kbd_enabled = conn_keywords.kbd_interactive_authentication.unwrap_or(true);

    // 如果指定了首选认证方式，按指定顺序添加
    if let Some(ref preferred) = conn_keywords.preferred_authentications {
        for auth in preferred {
            match auth.as_str() {
                "publickey" if pubkey_enabled => {
                    // 先尝试 SSH Agent
                    if is_ssh_agent_available() {
                        methods.push(SSHAuthMethod::Agent);
                    }
                    // 然后尝试身份文件
                    add_identity_file_methods(&mut methods, conn_keywords);
                }
                "keyboard-interactive" if kbd_enabled => {
                    methods.push(SSHAuthMethod::KeyboardInteractive);
                }
                "password" if password_enabled => {
                    if let Some(ref pwd) = password {
                        methods.push(SSHAuthMethod::Password(pwd.clone()));
                    }
                }
                _ => {}
            }
        }
        return methods;
    }

    // 默认顺序：Agent > 公钥文件 > 键盘交互 > 密码

    // 1. SSH Agent（如果可用）
    if pubkey_enabled && is_ssh_agent_available() {
        methods.push(SSHAuthMethod::Agent);
    }

    // 2. 公钥文件
    if pubkey_enabled {
        add_identity_file_methods(&mut methods, conn_keywords);
    }

    // 3. 键盘交互认证
    if kbd_enabled {
        methods.push(SSHAuthMethod::KeyboardInteractive);
    }

    // 4. 密码认证
    if password_enabled {
        if let Some(pwd) = password {
            methods.push(SSHAuthMethod::Password(pwd));
        }
    }

    methods
}

/// 添加身份文件认证方式
fn add_identity_file_methods(methods: &mut Vec<SSHAuthMethod>, conn_keywords: &ConnKeywords) {
    // 优先使用配置中指定的身份文件
    if let Some(ref identity_files) = conn_keywords.identity_file {
        for file in identity_files {
            let path = PathBuf::from(file);
            if path.exists() {
                methods.push(SSHAuthMethod::PublicKey {
                    key_path: path,
                    passphrase: None,
                });
            }
        }
    }

    // 然后添加默认身份文件
    for key_path in get_default_identity_files() {
        // 避免重复添加
        let already_added = methods
            .iter()
            .any(|m| matches!(m, SSHAuthMethod::PublicKey { key_path: p, .. } if p == &key_path));

        if !already_added {
            methods.push(SSHAuthMethod::PublicKey {
                key_path,
                passphrase: None,
            });
        }
    }
}

/// 检查 SSH Agent 是否可用
///
/// _Requirements: 4.6_
pub fn is_ssh_agent_available() -> bool {
    std::env::var("SSH_AUTH_SOCK").is_ok()
}

/// SSH 认证回调 trait
///
/// 用于在认证过程中与用户交互。
///
/// _Requirements: 4.5, 4.6_
pub trait SSHAuthCallback: Send + Sync {
    /// 请求密钥密码
    ///
    /// 当私钥需要密码时调用。
    fn request_passphrase(&self, key_path: &Path) -> Option<String>;

    /// 请求密码
    ///
    /// 当需要密码认证时调用。
    fn request_password(&self, username: &str, host: &str) -> Option<String>;

    /// 处理键盘交互提示
    ///
    /// 返回每个提示的响应。
    fn handle_keyboard_interactive(
        &self,
        username: &str,
        instructions: &str,
        prompts: &[(String, bool)], // (提示文本, 是否回显)
    ) -> Vec<String>;

    /// 确认主机密钥
    ///
    /// 当主机密钥未知时调用，返回是否接受。
    fn confirm_host_key(&self, host: &str, key_type: &str, fingerprint: &str) -> bool;

    /// 警告主机密钥不匹配
    ///
    /// 当主机密钥不匹配时调用，返回是否继续。
    fn warn_host_key_mismatch(&self, host: &str, key_type: &str, fingerprint: &str) -> bool;
}

/// 默认认证回调（无交互）
///
/// 用于批处理模式或测试。
pub struct NoOpAuthCallback;

impl SSHAuthCallback for NoOpAuthCallback {
    fn request_passphrase(&self, _key_path: &Path) -> Option<String> {
        None
    }

    fn request_password(&self, _username: &str, _host: &str) -> Option<String> {
        None
    }

    fn handle_keyboard_interactive(
        &self,
        _username: &str,
        _instructions: &str,
        prompts: &[(String, bool)],
    ) -> Vec<String> {
        // 返回空响应
        prompts.iter().map(|_| String::new()).collect()
    }

    fn confirm_host_key(&self, _host: &str, _key_type: &str, _fingerprint: &str) -> bool {
        false // 默认不接受未知主机
    }

    fn warn_host_key_mismatch(&self, _host: &str, _key_type: &str, _fingerprint: &str) -> bool {
        false // 默认不继续
    }
}

/// 检查连接名称是否为本地连接
///
/// _Requirements: 1.4, 1.5_
pub fn is_local_conn_name(conn_name: &str) -> bool {
    conn_name.is_empty() || conn_name == "local"
}

/// 检查连接名称是否为 SSH 连接
pub fn is_ssh_conn_name(conn_name: &str) -> bool {
    if is_local_conn_name(conn_name) {
        return false;
    }

    // 检查是否以 ssh:// 开头
    if conn_name.starts_with("ssh://") {
        return true;
    }

    // 检查是否包含 @ 符号（user@host 格式）
    if conn_name.contains('@') {
        return true;
    }

    // 检查是否不是 WSL 连接
    !conn_name.starts_with("wsl://")
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // SSHOpts 解析测试
    // ========================================================================

    #[test]
    fn test_parse_host_only() {
        let opts = SSHOpts::parse("example.com").unwrap();
        assert_eq!(opts.ssh_host, "example.com");
        assert_eq!(opts.ssh_user, None);
        assert_eq!(opts.ssh_port, None);
    }

    #[test]
    fn test_parse_user_at_host() {
        let opts = SSHOpts::parse("user@example.com").unwrap();
        assert_eq!(opts.ssh_host, "example.com");
        assert_eq!(opts.ssh_user, Some("user".to_string()));
        assert_eq!(opts.ssh_port, None);
    }

    #[test]
    fn test_parse_user_at_host_port() {
        let opts = SSHOpts::parse("user@example.com:2222").unwrap();
        assert_eq!(opts.ssh_host, "example.com");
        assert_eq!(opts.ssh_user, Some("user".to_string()));
        assert_eq!(opts.ssh_port, Some(2222));
    }

    #[test]
    fn test_parse_host_port() {
        let opts = SSHOpts::parse("example.com:2222").unwrap();
        assert_eq!(opts.ssh_host, "example.com");
        assert_eq!(opts.ssh_user, None);
        assert_eq!(opts.ssh_port, Some(2222));
    }

    #[test]
    fn test_parse_with_ssh_prefix() {
        let opts = SSHOpts::parse("ssh://user@example.com:2222").unwrap();
        assert_eq!(opts.ssh_host, "example.com");
        assert_eq!(opts.ssh_user, Some("user".to_string()));
        assert_eq!(opts.ssh_port, Some(2222));
    }

    #[test]
    fn test_parse_ipv6_address() {
        let opts = SSHOpts::parse("[::1]:22").unwrap();
        assert_eq!(opts.ssh_host, "::1");
        assert_eq!(opts.ssh_port, Some(22));
    }

    #[test]
    fn test_parse_ipv6_with_user() {
        let opts = SSHOpts::parse("user@[2001:db8::1]:22").unwrap();
        assert_eq!(opts.ssh_host, "2001:db8::1");
        assert_eq!(opts.ssh_user, Some("user".to_string()));
        assert_eq!(opts.ssh_port, Some(22));
    }

    #[test]
    fn test_parse_empty_string() {
        let result = SSHOpts::parse("");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_invalid_port() {
        let result = SSHOpts::parse("example.com:invalid");
        assert!(result.is_err());
    }

    #[test]
    fn test_effective_port() {
        let opts = SSHOpts::new("example.com");
        assert_eq!(opts.effective_port(), 22);

        let opts = SSHOpts::new("example.com").with_port(2222);
        assert_eq!(opts.effective_port(), 2222);
    }

    #[test]
    fn test_to_connection_string() {
        let opts = SSHOpts::new("example.com")
            .with_user("user")
            .with_port(2222);
        assert_eq!(opts.to_connection_string(), "user@example.com:2222");
    }

    #[test]
    fn test_to_connection_string_ipv6() {
        let opts = SSHOpts {
            ssh_host: "::1".to_string(),
            ssh_user: Some("user".to_string()),
            ssh_port: Some(22),
        };
        assert_eq!(opts.to_connection_string(), "user@[::1]:22");
    }

    // ========================================================================
    // 连接状态测试
    // ========================================================================

    #[test]
    fn test_connection_state_transitions() {
        assert!(ConnectionState::Init.can_transition_to(ConnectionState::Connecting));
        assert!(ConnectionState::Connecting.can_transition_to(ConnectionState::Connected));
        assert!(ConnectionState::Connecting.can_transition_to(ConnectionState::Error));
        assert!(ConnectionState::Connected.can_transition_to(ConnectionState::Disconnected));
        assert!(ConnectionState::Disconnected.can_transition_to(ConnectionState::Connecting));
        assert!(ConnectionState::Error.can_transition_to(ConnectionState::Connecting));

        // 无效转换
        assert!(!ConnectionState::Init.can_transition_to(ConnectionState::Connected));
        assert!(!ConnectionState::Connected.can_transition_to(ConnectionState::Init));
    }

    #[test]
    fn test_conn_status_default() {
        let status = ConnStatus::default();
        assert_eq!(status.status, "init");
        assert!(!status.connected);
        assert!(!status.has_connected);
    }

    #[test]
    fn test_conn_status_transitions() {
        let mut status = ConnStatus::new("user@example.com");

        status.set_connecting();
        assert_eq!(status.status, "connecting");
        assert!(!status.connected);

        status.set_connected();
        assert_eq!(status.status, "connected");
        assert!(status.connected);
        assert!(status.has_connected);

        status.set_disconnected();
        assert_eq!(status.status, "disconnected");
        assert!(!status.connected);
        assert!(status.has_connected); // 仍然为 true
    }

    // ========================================================================
    // SSH 配置解析测试
    // ========================================================================

    #[test]
    fn test_parse_ssh_config() {
        let config = r#"
Host example
    HostName example.com
    User admin
    Port 2222
    IdentityFile ~/.ssh/id_rsa

Host *
    User default_user
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let example = hosts.get("example").unwrap();
        assert_eq!(example.host, Some("example.com".to_string()));
        assert_eq!(example.user, Some("admin".to_string()));
        assert_eq!(example.port, Some(2222));

        let wildcard = hosts.get("*").unwrap();
        assert_eq!(wildcard.user, Some("default_user".to_string()));
    }

    #[test]
    fn test_parse_ssh_config_with_proxyjump() {
        let config = r#"
Host target
    HostName target.example.com
    ProxyJump bastion@jump.example.com
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let target = hosts.get("target").unwrap();
        assert_eq!(
            target.proxy_jump,
            Some("bastion@jump.example.com".to_string())
        );
    }

    // ========================================================================
    // 连接类型检测测试
    // ========================================================================

    #[test]
    fn test_is_local_conn_name() {
        assert!(is_local_conn_name(""));
        assert!(is_local_conn_name("local"));
        assert!(!is_local_conn_name("user@host"));
        assert!(!is_local_conn_name("ssh://host"));
    }

    #[test]
    fn test_is_ssh_conn_name() {
        assert!(is_ssh_conn_name("user@host"));
        assert!(is_ssh_conn_name("ssh://host"));
        assert!(is_ssh_conn_name("host.example.com"));
        assert!(!is_ssh_conn_name(""));
        assert!(!is_ssh_conn_name("local"));
        assert!(!is_ssh_conn_name("wsl://Ubuntu"));
    }

    // ========================================================================
    // SSH 认证测试
    // ========================================================================

    #[test]
    fn test_ssh_auth_method_variants() {
        // 测试各种认证方式的创建
        let pubkey = SSHAuthMethod::PublicKey {
            key_path: PathBuf::from("/home/user/.ssh/id_rsa"),
            passphrase: None,
        };
        assert!(matches!(pubkey, SSHAuthMethod::PublicKey { .. }));

        let pubkey_with_pass = SSHAuthMethod::PublicKey {
            key_path: PathBuf::from("/home/user/.ssh/id_rsa"),
            passphrase: Some("secret".to_string()),
        };
        assert!(matches!(
            pubkey_with_pass,
            SSHAuthMethod::PublicKey {
                passphrase: Some(_),
                ..
            }
        ));

        let agent = SSHAuthMethod::Agent;
        assert!(matches!(agent, SSHAuthMethod::Agent));

        let password = SSHAuthMethod::Password("secret".to_string());
        assert!(matches!(password, SSHAuthMethod::Password(_)));

        let kbd = SSHAuthMethod::KeyboardInteractive;
        assert!(matches!(kbd, SSHAuthMethod::KeyboardInteractive));
    }

    #[test]
    fn test_ssh_conn_creation() {
        let opts = SSHOpts::parse("user@example.com:22").unwrap();
        let conn = SSHConn::new(opts);

        assert_eq!(conn.state(), ConnectionState::Init);
        assert!(!conn.is_connected());
        assert!(conn.error().is_none());
    }

    #[test]
    fn test_ssh_conn_derive_status() {
        let opts = SSHOpts::parse("user@example.com").unwrap();
        let conn = SSHConn::new(opts);

        let status = conn.derive_conn_status();
        assert_eq!(status.status, "init");
        assert!(!status.connected);
        assert!(!status.has_connected);
        assert_eq!(status.connection, "user@example.com");
    }

    #[test]
    fn test_host_key_verification_variants() {
        // 测试主机密钥验证结果的各种变体
        let verified = HostKeyVerification::Verified;
        assert!(matches!(verified, HostKeyVerification::Verified));

        let unknown = HostKeyVerification::Unknown {
            host: "example.com".to_string(),
            key_type: "ssh-ed25519".to_string(),
            fingerprint: "SHA256:abc123".to_string(),
        };
        assert!(matches!(unknown, HostKeyVerification::Unknown { .. }));

        let mismatch = HostKeyVerification::Mismatch {
            host: "example.com".to_string(),
            key_type: "ssh-rsa".to_string(),
            fingerprint: "SHA256:xyz789".to_string(),
        };
        assert!(matches!(mismatch, HostKeyVerification::Mismatch { .. }));
    }

    // ========================================================================
    // SSH 配置解析扩展测试
    // ========================================================================

    #[test]
    fn test_parse_ssh_config_with_auth_options() {
        let config = r#"
Host secure
    HostName secure.example.com
    User admin
    PubkeyAuthentication yes
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PreferredAuthentications publickey,keyboard-interactive
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let secure = hosts.get("secure").unwrap();
        assert_eq!(secure.pubkey_authentication, Some(true));
        assert_eq!(secure.password_authentication, Some(false));
        assert_eq!(secure.kbd_interactive_authentication, Some(false));
        assert_eq!(
            secure.preferred_authentications,
            Some(vec![
                "publickey".to_string(),
                "keyboard-interactive".to_string()
            ])
        );
    }

    #[test]
    fn test_parse_ssh_config_with_multiple_identity_files() {
        let config = r#"
Host multi
    HostName multi.example.com
    IdentityFile ~/.ssh/id_ed25519
    IdentityFile ~/.ssh/id_rsa
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let multi = hosts.get("multi").unwrap();
        let identity_files = multi.identity_file.as_ref().unwrap();
        assert_eq!(identity_files.len(), 2);
    }

    #[test]
    fn test_parse_ssh_config_with_batch_mode() {
        let config = r#"
Host batch
    HostName batch.example.com
    BatchMode yes
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let batch = hosts.get("batch").unwrap();
        assert_eq!(batch.batch_mode, Some(true));
    }

    // ========================================================================
    // 认证方式构建测试
    // ========================================================================

    #[test]
    fn test_build_default_auth_methods_empty() {
        let keywords = ConnKeywords::default();
        let methods = build_default_auth_methods(&keywords, None);

        // 应该至少包含键盘交互认证
        assert!(methods
            .iter()
            .any(|m| matches!(m, SSHAuthMethod::KeyboardInteractive)));
    }

    #[test]
    fn test_build_default_auth_methods_with_password() {
        let keywords = ConnKeywords::default();
        let methods = build_default_auth_methods(&keywords, Some("secret".to_string()));

        // 应该包含密码认证
        assert!(methods
            .iter()
            .any(|m| matches!(m, SSHAuthMethod::Password(_))));
    }

    #[test]
    fn test_build_default_auth_methods_disabled_password() {
        let keywords = ConnKeywords {
            password_authentication: Some(false),
            ..Default::default()
        };
        let methods = build_default_auth_methods(&keywords, Some("secret".to_string()));

        // 不应该包含密码认证
        assert!(!methods
            .iter()
            .any(|m| matches!(m, SSHAuthMethod::Password(_))));
    }

    #[test]
    fn test_build_default_auth_methods_disabled_pubkey() {
        let keywords = ConnKeywords {
            pubkey_authentication: Some(false),
            ..Default::default()
        };
        let methods = build_default_auth_methods(&keywords, None);

        // 不应该包含公钥认证
        assert!(!methods
            .iter()
            .any(|m| matches!(m, SSHAuthMethod::PublicKey { .. })));
        assert!(!methods.iter().any(|m| matches!(m, SSHAuthMethod::Agent)));
    }

    #[test]
    fn test_build_default_auth_methods_preferred_order() {
        let keywords = ConnKeywords {
            preferred_authentications: Some(vec!["password".to_string(), "publickey".to_string()]),
            ..Default::default()
        };
        let methods = build_default_auth_methods(&keywords, Some("secret".to_string()));

        // 密码应该在前面
        let password_idx = methods
            .iter()
            .position(|m| matches!(m, SSHAuthMethod::Password(_)));
        assert!(password_idx.is_some());
    }

    // ========================================================================
    // NoOpAuthCallback 测试
    // ========================================================================

    #[test]
    fn test_noop_auth_callback() {
        let callback = NoOpAuthCallback;

        // 测试各个方法返回预期值
        assert!(callback
            .request_passphrase(&PathBuf::from("/test"))
            .is_none());
        assert!(callback.request_password("user", "host").is_none());

        let responses = callback.handle_keyboard_interactive(
            "user",
            "instructions",
            &[
                ("prompt1".to_string(), true),
                ("prompt2".to_string(), false),
            ],
        );
        assert_eq!(responses.len(), 2);
        assert!(responses.iter().all(|r| r.is_empty()));

        assert!(!callback.confirm_host_key("host", "ssh-rsa", "fingerprint"));
        assert!(!callback.warn_host_key_mismatch("host", "ssh-rsa", "fingerprint"));
    }

    // ========================================================================
    // SSH Agent 可用性测试
    // ========================================================================

    #[test]
    fn test_is_ssh_agent_available() {
        // 这个测试依赖于环境，只验证函数不会 panic
        let _ = is_ssh_agent_available();
    }

    // ========================================================================
    // SSH 配置文件解析增强测试
    // ========================================================================

    #[test]
    fn test_parse_ssh_config_with_equals_syntax() {
        let config = r#"
Host example
    HostName=example.com
    User=admin
    Port=2222
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let example = hosts.get("example").unwrap();
        assert_eq!(example.host, Some("example.com".to_string()));
        assert_eq!(example.user, Some("admin".to_string()));
        assert_eq!(example.port, Some(2222));
    }

    #[test]
    fn test_parse_ssh_config_with_quoted_values() {
        let config = r#"
Host example
    HostName "example.com"
    User 'admin'
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let example = hosts.get("example").unwrap();
        assert_eq!(example.host, Some("example.com".to_string()));
        assert_eq!(example.user, Some("admin".to_string()));
    }

    #[test]
    fn test_parse_ssh_config_with_multiple_host_patterns() {
        let config = r#"
Host server1 server2 server3
    User admin
    Port 22
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        // 每个模式都应该有相同的配置
        for host in &["server1", "server2", "server3"] {
            let config = hosts.get(*host).unwrap();
            assert_eq!(config.user, Some("admin".to_string()));
            assert_eq!(config.port, Some(22));
        }
    }

    #[test]
    fn test_parse_ssh_config_with_comments() {
        let config = r#"
# This is a comment
Host example
    # Another comment
    HostName example.com
    User admin  # Inline comments are not supported, this will be part of the value
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let example = hosts.get("example").unwrap();
        assert_eq!(example.host, Some("example.com".to_string()));
        // Note: inline comments are not stripped in this implementation
    }

    #[test]
    fn test_parse_ssh_config_with_proxy_command() {
        let config = r#"
Host target
    HostName target.example.com
    ProxyCommand ssh -W %h:%p bastion
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let target = hosts.get("target").unwrap();
        assert_eq!(
            target.proxy_command,
            Some("ssh -W %h:%p bastion".to_string())
        );
    }

    #[test]
    fn test_parse_ssh_config_with_connection_options() {
        let config = r#"
Host example
    HostName example.com
    ConnectTimeout 30
    ServerAliveInterval 60
    ServerAliveCountMax 3
    Compression yes
    ForwardAgent yes
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let example = hosts.get("example").unwrap();
        assert_eq!(example.connect_timeout, Some(30));
        assert_eq!(example.server_alive_interval, Some(60));
        assert_eq!(example.server_alive_count_max, Some(3));
        assert_eq!(example.compression, Some(true));
        assert_eq!(example.forward_agent, Some(true));
    }

    #[test]
    fn test_parse_ssh_config_with_port_forwarding() {
        let config = r#"
Host tunnel
    HostName tunnel.example.com
    LocalForward 8080 localhost:80
    LocalForward 8443 localhost:443
    RemoteForward 9000 localhost:9000
    DynamicForward 1080
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let tunnel = hosts.get("tunnel").unwrap();
        let local_forwards = tunnel.local_forward.as_ref().unwrap();
        assert_eq!(local_forwards.len(), 2);
        assert!(local_forwards.contains(&"8080 localhost:80".to_string()));

        let remote_forwards = tunnel.remote_forward.as_ref().unwrap();
        assert_eq!(remote_forwards.len(), 1);

        let dynamic_forwards = tunnel.dynamic_forward.as_ref().unwrap();
        assert_eq!(dynamic_forwards.len(), 1);
    }

    #[test]
    fn test_parse_ssh_config_with_env_options() {
        let config = r#"
Host example
    HostName example.com
    SendEnv LANG LC_*
    SetEnv FOO=bar
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();

        let example = hosts.get("example").unwrap();
        let send_env = example.send_env.as_ref().unwrap();
        assert_eq!(send_env.len(), 1);
        assert_eq!(send_env[0], "LANG LC_*");

        let set_env = example.set_env.as_ref().unwrap();
        assert_eq!(set_env.len(), 1);
        assert_eq!(set_env[0], "FOO=bar");
    }

    // ========================================================================
    // 配置合并测试
    // ========================================================================

    #[test]
    fn test_get_host_config_merges_wildcard() {
        let config = r#"
Host example
    HostName example.com
    User admin

Host *
    User default_user
    Port 22
    Compression yes
"#;
        let merged = SSHConfigParser::get_host_config_from_content(config, "example").unwrap();

        // 主机特定配置优先
        assert_eq!(merged.host, Some("example.com".to_string()));
        assert_eq!(merged.user, Some("admin".to_string()));
        // 通配符配置填充缺失值
        assert_eq!(merged.port, Some(22));
        assert_eq!(merged.compression, Some(true));
    }

    #[test]
    fn test_get_host_config_first_match_wins() {
        let config = r#"
Host example
    User first_user

Host example
    User second_user
"#;
        let merged = SSHConfigParser::get_host_config_from_content(config, "example").unwrap();

        // 第一个匹配的值优先
        assert_eq!(merged.user, Some("first_user".to_string()));
    }

    #[test]
    fn test_get_host_config_identity_files_accumulate() {
        let config = r#"
Host example
    IdentityFile ~/.ssh/id_example

Host *
    IdentityFile ~/.ssh/id_default
"#;
        let merged = SSHConfigParser::get_host_config_from_content(config, "example").unwrap();

        // IdentityFile 应该累加
        let identity_files = merged.identity_file.unwrap();
        assert_eq!(identity_files.len(), 2);
    }

    // ========================================================================
    // 通配符匹配测试
    // ========================================================================

    #[test]
    fn test_pattern_matching_exact() {
        assert!(SSHConfigParser::match_pattern("example.com", "example.com"));
        assert!(!SSHConfigParser::match_pattern("example.com", "other.com"));
    }

    #[test]
    fn test_pattern_matching_wildcard_all() {
        assert!(SSHConfigParser::match_pattern("*", "anything"));
        assert!(SSHConfigParser::match_pattern("*", ""));
    }

    #[test]
    fn test_pattern_matching_wildcard_suffix() {
        assert!(SSHConfigParser::match_pattern(
            "*.example.com",
            "server.example.com"
        ));
        assert!(SSHConfigParser::match_pattern(
            "*.example.com",
            "a.b.example.com"
        ));
        assert!(!SSHConfigParser::match_pattern(
            "*.example.com",
            "example.com"
        ));
    }

    #[test]
    fn test_pattern_matching_wildcard_prefix() {
        assert!(SSHConfigParser::match_pattern("server*", "server1"));
        assert!(SSHConfigParser::match_pattern("server*", "server-prod"));
        assert!(!SSHConfigParser::match_pattern("server*", "myserver"));
    }

    #[test]
    fn test_pattern_matching_question_mark() {
        assert!(SSHConfigParser::match_pattern("server?", "server1"));
        assert!(SSHConfigParser::match_pattern("server?", "serverA"));
        assert!(!SSHConfigParser::match_pattern("server?", "server12"));
    }

    #[test]
    fn test_pattern_matching_negation() {
        assert!(!SSHConfigParser::match_pattern(
            "!example.com",
            "example.com"
        ));
        assert!(SSHConfigParser::match_pattern("!example.com", "other.com"));
    }

    #[test]
    fn test_pattern_matching_complex() {
        assert!(SSHConfigParser::match_pattern(
            "*.prod.*",
            "server.prod.example"
        ));
        assert!(SSHConfigParser::match_pattern("web-??-*", "web-01-prod"));
    }

    // ========================================================================
    // ProxyJump 解析测试
    // ========================================================================

    #[test]
    fn test_parse_proxy_jump_chain_single() {
        let chain = SSHConfigParser::parse_proxy_jump_chain("bastion@jump.example.com");
        assert_eq!(chain.len(), 1);
        assert_eq!(chain[0], "bastion@jump.example.com");
    }

    #[test]
    fn test_parse_proxy_jump_chain_multiple() {
        let chain =
            SSHConfigParser::parse_proxy_jump_chain("jump1.com, user@jump2.com:2222, jump3.com");
        assert_eq!(chain.len(), 3);
        assert_eq!(chain[0], "jump1.com");
        assert_eq!(chain[1], "user@jump2.com:2222");
        assert_eq!(chain[2], "jump3.com");
    }

    #[test]
    fn test_parse_proxy_jump_chain_none() {
        let chain = SSHConfigParser::parse_proxy_jump_chain("none");
        assert!(chain.is_empty());

        let chain = SSHConfigParser::parse_proxy_jump_chain("NONE");
        assert!(chain.is_empty());

        let chain = SSHConfigParser::parse_proxy_jump_chain("");
        assert!(chain.is_empty());
    }

    #[test]
    fn test_parse_proxy_jump_host() {
        let opts = SSHConfigParser::parse_proxy_jump_host("user@jump.example.com:2222").unwrap();
        assert_eq!(opts.ssh_host, "jump.example.com");
        assert_eq!(opts.ssh_user, Some("user".to_string()));
        assert_eq!(opts.ssh_port, Some(2222));
    }

    // ========================================================================
    // 路径展开测试
    // ========================================================================

    #[test]
    fn test_expand_path_tilde() {
        let expanded = SSHConfigParser::expand_path("~/test");
        assert!(!expanded.starts_with("~/"));
        assert!(expanded.ends_with("test"));
    }

    #[test]
    fn test_expand_path_no_tilde() {
        let path = "/absolute/path";
        let expanded = SSHConfigParser::expand_path(path);
        assert_eq!(expanded, path);
    }

    // ========================================================================
    // 配置转连接字符串测试
    // ========================================================================

    #[test]
    fn test_config_to_connection_string() {
        let config = ConnKeywords {
            host: Some("real.example.com".to_string()),
            user: Some("admin".to_string()),
            port: Some(2222),
            ..Default::default()
        };

        let conn_str = SSHConfigParser::config_to_connection_string(&config, "alias");
        assert_eq!(conn_str, "admin@real.example.com:2222");
    }

    #[test]
    fn test_config_to_connection_string_uses_alias_when_no_hostname() {
        let config = ConnKeywords {
            user: Some("admin".to_string()),
            ..Default::default()
        };

        let conn_str = SSHConfigParser::config_to_connection_string(&config, "myserver");
        assert_eq!(conn_str, "admin@myserver");
    }

    // ========================================================================
    // 新增 ConnKeywords 字段测试
    // ========================================================================

    #[test]
    fn test_conn_keywords_strict_host_key_checking() {
        let config = r#"
Host example
    StrictHostKeyChecking ask
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();
        let example = hosts.get("example").unwrap();
        assert_eq!(example.strict_host_key_checking, Some("ask".to_string()));
    }

    #[test]
    fn test_conn_keywords_request_tty() {
        let config = r#"
Host example
    RequestTTY force
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();
        let example = hosts.get("example").unwrap();
        assert_eq!(example.request_tty, Some("force".to_string()));
    }

    #[test]
    fn test_conn_keywords_remote_command() {
        let config = r#"
Host example
    RemoteCommand /bin/bash -l
"#;
        let hosts = SSHConfigParser::parse_config_content(config).unwrap();
        let example = hosts.get("example").unwrap();
        assert_eq!(example.remote_command, Some("/bin/bash -l".to_string()));
    }
}
