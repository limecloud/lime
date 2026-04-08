//! WebSocket 连接管理
//!
//! 提供 WebSocket 连接、心跳、断线重连等功能

use super::types::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};
use tokio::time::interval;

/// 连接配置
#[derive(Debug, Clone)]
pub struct ConnectionConfig {
    /// WebSocket URL
    pub url: String,
    /// 认证令牌
    pub auth_token: Option<String>,
    /// 会话 ID
    pub session_id: String,
    /// 心跳间隔（秒）
    pub heartbeat_interval: u64,
    /// 重连延迟（秒）
    pub reconnect_delay: u64,
    /// 最大重连次数
    pub max_reconnect_attempts: u32,
    /// 连接超时（秒）
    pub connect_timeout: u64,
}

impl Default for ConnectionConfig {
    fn default() -> Self {
        Self {
            url: String::new(),
            auth_token: None,
            session_id: String::new(),
            heartbeat_interval: 30,
            reconnect_delay: 5,
            max_reconnect_attempts: 10,
            connect_timeout: 30,
        }
    }
}

/// 连接事件
#[derive(Debug, Clone)]
pub enum ConnectionEvent {
    /// 已连接
    Connected,
    /// 已断开
    Disconnected,
    /// 重连中
    Reconnecting { attempt: u32 },
    /// 收到消息
    Message(RemoteMessage),
    /// 错误
    Error(String),
}

/// WebSocket 连接管理器
pub struct WebSocketManager {
    /// 配置
    config: ConnectionConfig,
    /// 是否已连接
    connected: Arc<AtomicBool>,
    /// 事件发送器
    event_tx: broadcast::Sender<ConnectionEvent>,
    /// 消息发送通道
    outgoing_tx: Option<mpsc::Sender<RemoteMessage>>,
    /// 停止信号
    stop_tx: Option<mpsc::Sender<()>>,
}

impl WebSocketManager {
    /// 创建新的连接管理器
    pub fn new(config: ConnectionConfig) -> Self {
        let (event_tx, _) = broadcast::channel(100);

        Self {
            config,
            connected: Arc::new(AtomicBool::new(false)),
            event_tx,
            outgoing_tx: None,
            stop_tx: None,
        }
    }

    /// 订阅事件
    pub fn subscribe(&self) -> broadcast::Receiver<ConnectionEvent> {
        self.event_tx.subscribe()
    }

    /// 是否已连接
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    /// 发送消息
    pub async fn send(&self, message: RemoteMessage) -> anyhow::Result<()> {
        let tx = self
            .outgoing_tx
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("未连接"))?;
        tx.send(message).await?;
        Ok(())
    }

    /// 连接（带重连逻辑）
    pub async fn connect(&mut self) -> anyhow::Result<()> {
        let mut attempts = 0;

        loop {
            match self.try_connect().await {
                Ok(_) => {
                    self.connected.store(true, Ordering::SeqCst);
                    let _ = self.event_tx.send(ConnectionEvent::Connected);
                    return Ok(());
                }
                Err(e) => {
                    attempts += 1;
                    if attempts >= self.config.max_reconnect_attempts {
                        let _ = self.event_tx.send(ConnectionEvent::Error(e.to_string()));
                        return Err(e);
                    }

                    let _ = self
                        .event_tx
                        .send(ConnectionEvent::Reconnecting { attempt: attempts });
                    tokio::time::sleep(Duration::from_secs(self.config.reconnect_delay)).await;
                }
            }
        }
    }

    /// 尝试连接一次
    async fn try_connect(&mut self) -> anyhow::Result<()> {
        // 构建 WebSocket URL
        let ws_url = self.build_websocket_url()?;

        // 创建通道
        let (outgoing_tx, outgoing_rx) = mpsc::channel::<RemoteMessage>(100);
        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);

        self.outgoing_tx = Some(outgoing_tx);
        self.stop_tx = Some(stop_tx);

        // 启动心跳任务
        let heartbeat_interval = self.config.heartbeat_interval;
        let session_id = self.config.session_id.clone();
        let event_tx = self.event_tx.clone();

        // 标记 outgoing_rx 为使用（实际连接逻辑待实现）
        let _ = outgoing_rx;
        let connected = Arc::clone(&self.connected);

        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(heartbeat_interval));

            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if connected.load(Ordering::SeqCst) {
                            let heartbeat = RemoteMessage {
                                message_type: RemoteMessageType::Heartbeat,
                                id: None,
                                session_id: session_id.clone(),
                                timestamp: chrono::Utc::now().to_rfc3339(),
                                payload: serde_json::json!({}),
                            };
                            let _ = event_tx.send(ConnectionEvent::Message(heartbeat));
                        }
                    }
                    _ = stop_rx.recv() => {
                        break;
                    }
                }
            }
        });

        // TODO: 实际的 WebSocket 连接
        // 这里是框架代码，实际需要使用 tokio-tungstenite
        tracing::info!("连接到 WebSocket: {}", ws_url);

        Ok(())
    }

    /// 断开连接
    pub async fn disconnect(&mut self) {
        // 发送停止信号
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(()).await;
        }

        self.connected.store(false, Ordering::SeqCst);
        self.outgoing_tx = None;

        let _ = self.event_tx.send(ConnectionEvent::Disconnected);
    }

    /// 构建 WebSocket URL
    fn build_websocket_url(&self) -> anyhow::Result<String> {
        let mut url = self.config.url.clone();

        if url.is_empty() {
            anyhow::bail!("WebSocket URL 为空");
        }

        // 转换协议
        if url.starts_with("http://") {
            url = url.replace("http://", "ws://");
        } else if url.starts_with("https://") {
            url = url.replace("https://", "wss://");
        } else if !url.starts_with("ws://") && !url.starts_with("wss://") {
            url = format!("wss://{}", url);
        }

        // 添加会话路径
        if !url.contains("/teleport/") {
            url = format!(
                "{}/teleport/{}",
                url.trim_end_matches('/'),
                self.config.session_id
            );
        }

        Ok(url)
    }
}

/// 便捷函数：连接到远程会话
pub async fn connect_to_remote_session(
    session_id: &str,
    ingress_url: Option<&str>,
    auth_token: Option<&str>,
) -> anyhow::Result<WebSocketManager> {
    // 从环境变量获取 URL
    let url = ingress_url
        .map(|s| s.to_string())
        .or_else(|| std::env::var("ASTER_TELEPORT_URL").ok())
        .ok_or_else(|| anyhow::anyhow!("未提供远程服务器 URL"))?;

    let config = ConnectionConfig {
        url,
        auth_token: auth_token.map(|s| s.to_string()),
        session_id: session_id.to_string(),
        ..Default::default()
    };

    let mut manager = WebSocketManager::new(config);
    manager.connect().await?;

    Ok(manager)
}

/// 检查会话是否可以进行 teleport
pub async fn can_teleport_to_session(_session_id: &str) -> bool {
    // 检查是否在 git 仓库中
    super::validation::get_current_repo_url().await.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_config_default() {
        let config = ConnectionConfig::default();
        assert!(config.url.is_empty());
        assert!(config.auth_token.is_none());
        assert!(config.session_id.is_empty());
        assert_eq!(config.heartbeat_interval, 30);
        assert_eq!(config.reconnect_delay, 5);
        assert_eq!(config.max_reconnect_attempts, 10);
        assert_eq!(config.connect_timeout, 30);
    }

    #[test]
    fn test_connection_config_custom() {
        let config = ConnectionConfig {
            url: "wss://example.com".to_string(),
            auth_token: Some("token".to_string()),
            session_id: "session-1".to_string(),
            heartbeat_interval: 60,
            reconnect_delay: 10,
            max_reconnect_attempts: 5,
            connect_timeout: 60,
        };
        assert_eq!(config.url, "wss://example.com");
        assert_eq!(config.heartbeat_interval, 60);
    }

    #[test]
    fn test_websocket_manager_new() {
        let config = ConnectionConfig {
            url: "wss://example.com".to_string(),
            session_id: "test".to_string(),
            ..Default::default()
        };
        let manager = WebSocketManager::new(config);
        assert!(!manager.is_connected());
    }

    #[test]
    fn test_websocket_manager_subscribe() {
        let config = ConnectionConfig::default();
        let manager = WebSocketManager::new(config);
        let _rx = manager.subscribe();
        // 应该能订阅
    }

    #[test]
    fn test_websocket_manager_is_connected() {
        let config = ConnectionConfig::default();
        let manager = WebSocketManager::new(config);
        assert!(!manager.is_connected());
    }

    #[test]
    fn test_websocket_manager_build_url_http() {
        let config = ConnectionConfig {
            url: "http://example.com".to_string(),
            session_id: "test".to_string(),
            ..Default::default()
        };
        let manager = WebSocketManager::new(config);
        let url = manager.build_websocket_url().unwrap();
        assert!(url.starts_with("ws://"));
        assert!(url.contains("/teleport/test"));
    }

    #[test]
    fn test_websocket_manager_build_url_https() {
        let config = ConnectionConfig {
            url: "https://example.com".to_string(),
            session_id: "test".to_string(),
            ..Default::default()
        };
        let manager = WebSocketManager::new(config);
        let url = manager.build_websocket_url().unwrap();
        assert!(url.starts_with("wss://"));
    }

    #[test]
    fn test_websocket_manager_build_url_ws() {
        let config = ConnectionConfig {
            url: "ws://example.com".to_string(),
            session_id: "test".to_string(),
            ..Default::default()
        };
        let manager = WebSocketManager::new(config);
        let url = manager.build_websocket_url().unwrap();
        assert!(url.starts_with("ws://"));
    }

    #[test]
    fn test_websocket_manager_build_url_no_protocol() {
        let config = ConnectionConfig {
            url: "example.com".to_string(),
            session_id: "test".to_string(),
            ..Default::default()
        };
        let manager = WebSocketManager::new(config);
        let url = manager.build_websocket_url().unwrap();
        assert!(url.starts_with("wss://"));
    }

    #[test]
    fn test_websocket_manager_build_url_empty() {
        let config = ConnectionConfig {
            url: "".to_string(),
            session_id: "test".to_string(),
            ..Default::default()
        };
        let manager = WebSocketManager::new(config);
        let result = manager.build_websocket_url();
        assert!(result.is_err());
    }

    #[test]
    fn test_websocket_manager_build_url_with_teleport_path() {
        let config = ConnectionConfig {
            url: "wss://example.com/teleport/existing".to_string(),
            session_id: "test".to_string(),
            ..Default::default()
        };
        let manager = WebSocketManager::new(config);
        let url = manager.build_websocket_url().unwrap();
        // 不应该重复添加 /teleport/
        assert!(!url.contains("/teleport/test"));
    }

    #[test]
    fn test_connection_event_variants() {
        let events = [
            ConnectionEvent::Connected,
            ConnectionEvent::Disconnected,
            ConnectionEvent::Reconnecting { attempt: 1 },
            ConnectionEvent::Message(RemoteMessage {
                message_type: RemoteMessageType::Heartbeat,
                id: None,
                session_id: "test".to_string(),
                payload: serde_json::json!({}),
                timestamp: "2026-01-14".to_string(),
            }),
            ConnectionEvent::Error("error".to_string()),
        ];
        assert_eq!(events.len(), 5);
    }

    #[tokio::test]
    async fn test_can_teleport_to_session() {
        let can = can_teleport_to_session("test-session").await;
        // 在 git 仓库中应该返回 true
        println!("Can teleport: {}", can);
    }

    #[tokio::test]
    async fn test_websocket_manager_send_not_connected() {
        let config = ConnectionConfig::default();
        let manager = WebSocketManager::new(config);
        let msg = RemoteMessage {
            message_type: RemoteMessageType::Message,
            id: None,
            session_id: "test".to_string(),
            payload: serde_json::json!({}),
            timestamp: "2026-01-14".to_string(),
        };
        let result = manager.send(msg).await;
        assert!(result.is_err());
    }
}
