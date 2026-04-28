//! Lime WebSocket 支持模块
//!
//! 提供 WebSocket API 支持，允许客户端通过持久连接发送请求：
//! - 连接握手和升级
//! - 消息解析和处理

#![allow(clippy::all)]
//! - 流式响应转发
//! - 心跳检测和连接生命周期管理

#![allow(dead_code)]

pub mod handler;
pub mod handlers;
pub mod lifecycle;
pub mod processor;
pub mod protocol;
pub mod stream;

pub use handlers::RpcHandler;
pub use lime_core::websocket::types;
pub use lime_core::websocket::{
    WsApiRequest, WsApiResponse, WsConfig, WsConnection, WsEndpoint, WsError, WsMessage, WsStats,
    WsStatsSnapshot, WsStreamChunk, WsStreamEnd,
};
pub use processor::MessageProcessor;
pub use protocol::{GatewayRpcRequest, GatewayRpcResponse, RpcError, RpcMethod};

use dashmap::DashMap;
use std::sync::Arc;

/// WebSocket 连接管理器
#[derive(Debug)]
pub struct WsConnectionManager {
    /// 活跃连接映射
    connections: DashMap<String, WsConnection>,
    /// 配置
    config: WsConfig,
    /// 统计信息
    stats: Arc<WsStats>,
}

impl WsConnectionManager {
    /// 创建新的连接管理器
    pub fn new(config: WsConfig) -> Self {
        Self {
            connections: DashMap::new(),
            config,
            stats: Arc::new(WsStats::new()),
        }
    }

    /// 使用默认配置创建
    pub fn with_defaults() -> Self {
        Self::new(WsConfig::default())
    }

    /// 注册新连接
    pub fn register(&self, id: String, client_info: Option<String>) -> Result<(), WsError> {
        if self.connections.len() >= self.config.max_connections {
            return Err(WsError::internal(
                None,
                format!(
                    "Maximum connections ({}) reached",
                    self.config.max_connections
                ),
            ));
        }
        let conn = WsConnection::new(id.clone(), client_info);
        self.connections.insert(id, conn);
        self.stats.on_connect();
        Ok(())
    }

    /// 注销连接
    pub fn unregister(&self, id: &str) -> Option<WsConnection> {
        let removed = self.connections.remove(id).map(|(_, conn)| conn);
        if removed.is_some() {
            self.stats.on_disconnect();
        }
        removed
    }

    /// 获取连接信息
    pub fn get(&self, id: &str) -> Option<WsConnection> {
        self.connections.get(id).map(|r| r.clone())
    }

    /// 更新连接请求计数
    pub fn increment_request_count(&self, id: &str) {
        if let Some(mut conn) = self.connections.get_mut(id) {
            conn.increment_request_count();
        }
    }

    /// 获取活跃连接数
    pub fn active_count(&self) -> usize {
        self.connections.len()
    }

    /// 获取所有连接信息
    pub fn list_connections(&self) -> Vec<WsConnection> {
        self.connections.iter().map(|r| r.clone()).collect()
    }

    /// 获取统计信息
    pub fn stats(&self) -> &Arc<WsStats> {
        &self.stats
    }

    /// 获取配置
    pub fn config(&self) -> &WsConfig {
        &self.config
    }

    /// 记录消息
    pub fn on_message(&self) {
        self.stats.on_message();
    }

    /// 记录错误
    pub fn on_error(&self) {
        self.stats.on_error();
    }
}

impl Default for WsConnectionManager {
    fn default() -> Self {
        Self::with_defaults()
    }
}

#[cfg(test)]
mod tests;
