//! WebSocket 类型定义
//!
//! 定义 WebSocket 连接、消息和配置类型

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

/// WebSocket 连接信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsConnection {
    /// 连接唯一标识
    pub id: String,
    /// 连接建立时间
    pub connected_at: DateTime<Utc>,
    /// 客户端信息（User-Agent 等）
    pub client_info: Option<String>,
    /// 请求计数
    pub request_count: u64,
    /// 连接状态
    pub status: WsConnectionStatus,
}

impl WsConnection {
    /// 创建新连接
    pub fn new(id: String, client_info: Option<String>) -> Self {
        Self {
            id,
            connected_at: Utc::now(),
            client_info,
            request_count: 0,
            status: WsConnectionStatus::Connected,
        }
    }

    /// 增加请求计数
    pub fn increment_request_count(&mut self) {
        self.request_count += 1;
    }
}

/// WebSocket 连接状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WsConnectionStatus {
    /// 已连接
    Connected,
    /// 正在关闭
    Closing,
    /// 已关闭
    Closed,
}

/// WebSocket 消息类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    /// API 请求消息
    Request(WsApiRequest),
    /// API 响应消息
    Response(WsApiResponse),
    /// 流式响应块
    StreamChunk(WsStreamChunk),
    /// 流式响应结束
    StreamEnd(WsStreamEnd),
    /// 错误消息
    Error(WsError),
    /// 心跳请求
    Ping { timestamp: i64 },
    /// 心跳响应
    Pong { timestamp: i64 },
}

/// WebSocket API 请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsApiRequest {
    /// 请求 ID（用于关联响应）
    pub request_id: String,
    /// API 端点类型
    pub endpoint: WsEndpoint,
    /// 请求体（JSON）
    pub payload: serde_json::Value,
}

/// API 端点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WsEndpoint {
    /// OpenAI 兼容的 chat completions
    ChatCompletions,
    /// Anthropic 兼容的 messages
    Messages,
    /// 模型列表
    Models,
}

/// WebSocket API 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsApiResponse {
    /// 请求 ID（关联请求）
    pub request_id: String,
    /// 响应体（JSON）
    pub payload: serde_json::Value,
}

/// WebSocket 流式响应块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsStreamChunk {
    /// 请求 ID（关联请求）
    pub request_id: String,
    /// 块索引
    pub index: u32,
    /// 数据块（SSE data 内容）
    pub data: String,
}

/// WebSocket 流式响应结束
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsStreamEnd {
    /// 请求 ID（关联请求）
    pub request_id: String,
    /// 总块数
    pub total_chunks: u32,
}

/// WebSocket 错误
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsError {
    /// 请求 ID（如果有关联请求）
    pub request_id: Option<String>,
    /// 错误码
    pub code: WsErrorCode,
    /// 错误消息
    pub message: String,
}

/// WebSocket 错误码
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WsErrorCode {
    /// 无效消息格式
    InvalidMessage,
    /// 无效请求
    InvalidRequest,
    /// 认证失败
    Unauthorized,
    /// 内部错误
    InternalError,
    /// 上游错误
    UpstreamError,
    /// 请求超时
    Timeout,
}

impl WsError {
    /// 创建无效消息错误
    pub fn invalid_message(message: impl Into<String>) -> Self {
        Self {
            request_id: None,
            code: WsErrorCode::InvalidMessage,
            message: message.into(),
        }
    }

    /// 创建无效请求错误
    pub fn invalid_request(request_id: Option<String>, message: impl Into<String>) -> Self {
        Self {
            request_id,
            code: WsErrorCode::InvalidRequest,
            message: message.into(),
        }
    }

    /// 创建认证失败错误
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            request_id: None,
            code: WsErrorCode::Unauthorized,
            message: message.into(),
        }
    }

    /// 创建内部错误
    pub fn internal(request_id: Option<String>, message: impl Into<String>) -> Self {
        Self {
            request_id,
            code: WsErrorCode::InternalError,
            message: message.into(),
        }
    }

    /// 创建上游错误
    pub fn upstream(request_id: Option<String>, message: impl Into<String>) -> Self {
        Self {
            request_id,
            code: WsErrorCode::UpstreamError,
            message: message.into(),
        }
    }
}

/// WebSocket 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsConfig {
    /// 是否启用 WebSocket
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// 心跳间隔（秒）
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval_secs: u64,
    /// 心跳超时（秒）
    #[serde(default = "default_heartbeat_timeout")]
    pub heartbeat_timeout_secs: u64,
    /// 最大连接数
    #[serde(default = "default_max_connections")]
    pub max_connections: usize,
    /// 消息大小限制（字节）
    #[serde(default = "default_max_message_size")]
    pub max_message_size: usize,
}

fn default_enabled() -> bool {
    true
}

fn default_heartbeat_interval() -> u64 {
    30
}

fn default_heartbeat_timeout() -> u64 {
    60
}

fn default_max_connections() -> usize {
    100
}

fn default_max_message_size() -> usize {
    16 * 1024 * 1024 // 16MB
}

impl Default for WsConfig {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            heartbeat_interval_secs: default_heartbeat_interval(),
            heartbeat_timeout_secs: default_heartbeat_timeout(),
            max_connections: default_max_connections(),
            max_message_size: default_max_message_size(),
        }
    }
}

/// WebSocket 服务器统计
#[derive(Debug, Default)]
pub struct WsStats {
    /// 总连接数
    pub total_connections: AtomicU64,
    /// 活跃连接数
    pub active_connections: AtomicU64,
    /// 总消息数
    pub total_messages: AtomicU64,
    /// 总错误数
    pub total_errors: AtomicU64,
}

impl WsStats {
    /// 创建新的统计实例
    pub fn new() -> Self {
        Self::default()
    }

    /// 记录新连接
    pub fn on_connect(&self) {
        self.total_connections.fetch_add(1, Ordering::Relaxed);
        self.active_connections.fetch_add(1, Ordering::Relaxed);
    }

    /// 记录断开连接
    pub fn on_disconnect(&self) {
        self.active_connections.fetch_sub(1, Ordering::Relaxed);
    }

    /// 记录消息
    pub fn on_message(&self) {
        self.total_messages.fetch_add(1, Ordering::Relaxed);
    }

    /// 记录错误
    pub fn on_error(&self) {
        self.total_errors.fetch_add(1, Ordering::Relaxed);
    }

    /// 获取活跃连接数
    pub fn active_count(&self) -> u64 {
        self.active_connections.load(Ordering::Relaxed)
    }

    /// 获取统计快照
    pub fn snapshot(&self) -> WsStatsSnapshot {
        WsStatsSnapshot {
            total_connections: self.total_connections.load(Ordering::Relaxed),
            active_connections: self.active_connections.load(Ordering::Relaxed),
            total_messages: self.total_messages.load(Ordering::Relaxed),
            total_errors: self.total_errors.load(Ordering::Relaxed),
        }
    }
}

/// WebSocket 统计快照（可序列化）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsStatsSnapshot {
    pub total_connections: u64,
    pub active_connections: u64,
    pub total_messages: u64,
    pub total_errors: u64,
}
