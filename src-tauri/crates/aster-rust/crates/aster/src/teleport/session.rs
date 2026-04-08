//! 远程会话管理
//!
//! 通过 WebSocket 连接到远程会话

use super::types::*;
use super::validation::validate_session_repository;
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;

/// 远程会话
pub struct RemoteSession {
    /// 配置
    config: TeleportConfig,
    /// 状态
    state: Arc<RwLock<RemoteSessionState>>,
    /// 消息发送器
    message_tx: Option<mpsc::Sender<RemoteMessage>>,
    /// 消息接收器
    message_rx: Option<mpsc::Receiver<RemoteMessage>>,
}

impl RemoteSession {
    /// 创建新的远程会话
    pub fn new(config: TeleportConfig) -> Self {
        let state = RemoteSessionState {
            connection_state: ConnectionState::Disconnected,
            sync_state: SyncState::default(),
            config: config.clone(),
            error: None,
        };

        Self {
            config,
            state: Arc::new(RwLock::new(state)),
            message_tx: None,
            message_rx: None,
        }
    }

    /// 连接到远程会话
    pub async fn connect(&mut self) -> anyhow::Result<()> {
        // 验证仓库
        let session_repo = self
            .config
            .metadata
            .as_ref()
            .and_then(|m| m.repo.as_deref());
        let validation = validate_session_repository(session_repo).await;

        if validation.status == RepoValidationStatus::Mismatch {
            let error = format!(
                "仓库不匹配: 会话仓库 {:?}, 当前仓库 {:?}",
                validation.session_repo, validation.current_repo
            );
            self.set_error(&error);
            anyhow::bail!(error);
        }

        if validation.status == RepoValidationStatus::Error {
            let error = validation
                .error_message
                .unwrap_or_else(|| "仓库验证失败".to_string());
            self.set_error(&error);
            anyhow::bail!(error);
        }

        // 检查 ingress URL
        let Some(_ingress_url) = &self.config.ingress_url else {
            let error = "未提供远程服务器 URL";
            self.set_error(error);
            anyhow::bail!(error);
        };

        // 设置连接状态
        self.set_connection_state(ConnectionState::Connecting);

        // 创建消息通道
        let (tx, rx) = mpsc::channel(100);
        self.message_tx = Some(tx);
        self.message_rx = Some(rx);

        // TODO: 实际的 WebSocket 连接逻辑
        // 这里只是框架，实际实现需要使用 tokio-tungstenite 等库

        self.set_connection_state(ConnectionState::Connected);
        Ok(())
    }

    /// 断开连接
    pub async fn disconnect(&mut self) {
        self.message_tx = None;
        self.message_rx = None;
        self.set_connection_state(ConnectionState::Disconnected);
    }

    /// 发送消息
    pub async fn send_message(&self, message: RemoteMessage) -> anyhow::Result<()> {
        let Some(tx) = &self.message_tx else {
            anyhow::bail!("未连接到远程会话");
        };
        tx.send(message).await?;
        Ok(())
    }

    /// 获取当前状态
    pub fn get_state(&self) -> RemoteSessionState {
        self.state
            .read()
            .map(|s| s.clone())
            .unwrap_or_else(|_| RemoteSessionState {
                connection_state: ConnectionState::Error,
                sync_state: SyncState::default(),
                config: self.config.clone(),
                error: Some("状态读取失败".to_string()),
            })
    }

    /// 检查是否已连接
    pub fn is_connected(&self) -> bool {
        self.state
            .read()
            .map(|s| s.connection_state == ConnectionState::Connected)
            .unwrap_or(false)
    }

    /// 设置连接状态
    fn set_connection_state(&self, state: ConnectionState) {
        if let Ok(mut s) = self.state.write() {
            s.connection_state = state;
            if state != ConnectionState::Error {
                s.error = None;
            }
        }
    }

    /// 设置错误
    fn set_error(&self, error: &str) {
        if let Ok(mut s) = self.state.write() {
            s.connection_state = ConnectionState::Error;
            s.error = Some(error.to_string());
        }
    }

    /// 请求同步
    pub async fn request_sync(&self) -> anyhow::Result<()> {
        if !self.is_connected() {
            anyhow::bail!("未连接到远程会话");
        }

        self.set_connection_state(ConnectionState::Syncing);

        let sync_request = RemoteMessage {
            message_type: RemoteMessageType::SyncRequest,
            id: None,
            session_id: self.config.session_id.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            payload: serde_json::json!({}),
        };

        self.send_message(sync_request).await?;
        Ok(())
    }
}

/// 创建远程会话
pub fn create_remote_session(config: TeleportConfig) -> RemoteSession {
    RemoteSession::new(config)
}
