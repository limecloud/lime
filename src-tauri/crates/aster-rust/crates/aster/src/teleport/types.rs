//! Teleport 类型定义
//!
//! 远程会话连接的数据结构

use serde::{Deserialize, Serialize};

/// 远程会话配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportConfig {
    /// 会话 ID
    pub session_id: String,
    /// 远程服务器 URL (WebSocket)
    pub ingress_url: Option<String>,
    /// 认证令牌
    pub auth_token: Option<String>,
    /// 会话元数据
    pub metadata: Option<TeleportMetadata>,
}

/// 会话元数据
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TeleportMetadata {
    /// 仓库
    pub repo: Option<String>,
    /// 分支
    pub branch: Option<String>,
    /// 创建时间
    pub created_at: Option<String>,
    /// 更新时间
    pub updated_at: Option<String>,
}

/// 仓库验证状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepoValidationStatus {
    /// 仓库匹配
    Match,
    /// 仓库不匹配
    Mismatch,
    /// 不需要验证
    NoValidation,
    /// 验证错误
    Error,
}

/// 仓库验证结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoValidationResult {
    /// 验证状态
    pub status: RepoValidationStatus,
    /// 会话仓库
    pub session_repo: Option<String>,
    /// 当前仓库
    pub current_repo: Option<String>,
    /// 错误消息
    pub error_message: Option<String>,
}

/// 远程消息类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteMessageType {
    /// 同步请求
    SyncRequest,
    /// 同步响应
    SyncResponse,
    /// 用户消息
    Message,
    /// 助手消息
    AssistantMessage,
    /// 工具执行结果
    ToolResult,
    /// 心跳
    Heartbeat,
    /// 错误
    Error,
}

/// 远程消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteMessage {
    /// 消息类型
    pub message_type: RemoteMessageType,
    /// 消息 ID
    pub id: Option<String>,
    /// 会话 ID
    pub session_id: String,
    /// 消息内容
    pub payload: serde_json::Value,
    /// 时间戳
    pub timestamp: String,
}

/// 同步状态
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncState {
    /// 是否正在同步
    pub syncing: bool,
    /// 最后同步时间
    pub last_sync_time: Option<String>,
    /// 同步的消息数量
    pub synced_messages: u32,
    /// 同步错误
    pub sync_error: Option<String>,
}

/// 连接状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    /// 未连接
    #[default]
    Disconnected,
    /// 连接中
    Connecting,
    /// 已连接
    Connected,
    /// 同步中
    Syncing,
    /// 错误
    Error,
}

/// 远程会话状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSessionState {
    /// 连接状态
    pub connection_state: ConnectionState,
    /// 同步状态
    pub sync_state: SyncState,
    /// 会话配置
    pub config: TeleportConfig,
    /// 错误信息
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_teleport_config() {
        let config = TeleportConfig {
            session_id: "test-session".to_string(),
            ingress_url: Some("wss://example.com".to_string()),
            auth_token: Some("token".to_string()),
            metadata: Some(TeleportMetadata {
                repo: Some("https://github.com/user/repo".to_string()),
                branch: Some("main".to_string()),
                created_at: Some("2026-01-14".to_string()),
                updated_at: None,
            }),
        };
        assert_eq!(config.session_id, "test-session");
        assert!(config.ingress_url.is_some());
    }

    #[test]
    fn test_teleport_metadata_default() {
        let metadata = TeleportMetadata::default();
        assert!(metadata.repo.is_none());
        assert!(metadata.branch.is_none());
    }

    #[test]
    fn test_repo_validation_status_variants() {
        let statuses = [
            RepoValidationStatus::Match,
            RepoValidationStatus::Mismatch,
            RepoValidationStatus::NoValidation,
            RepoValidationStatus::Error,
        ];
        assert_eq!(statuses.len(), 4);
    }

    #[test]
    fn test_repo_validation_result() {
        let result = RepoValidationResult {
            status: RepoValidationStatus::Match,
            session_repo: Some("repo1".to_string()),
            current_repo: Some("repo1".to_string()),
            error_message: None,
        };
        assert_eq!(result.status, RepoValidationStatus::Match);
    }

    #[test]
    fn test_remote_message_type_variants() {
        let types = [
            RemoteMessageType::SyncRequest,
            RemoteMessageType::SyncResponse,
            RemoteMessageType::Message,
            RemoteMessageType::AssistantMessage,
            RemoteMessageType::ToolResult,
            RemoteMessageType::Heartbeat,
            RemoteMessageType::Error,
        ];
        assert_eq!(types.len(), 7);
    }

    #[test]
    fn test_remote_message() {
        let msg = RemoteMessage {
            message_type: RemoteMessageType::Message,
            id: Some("msg-1".to_string()),
            session_id: "session-1".to_string(),
            payload: serde_json::json!({"text": "hello"}),
            timestamp: "2026-01-14T00:00:00Z".to_string(),
        };
        assert_eq!(msg.message_type, RemoteMessageType::Message);
        assert_eq!(msg.session_id, "session-1");
    }

    #[test]
    fn test_sync_state_default() {
        let state = SyncState::default();
        assert!(!state.syncing);
        assert!(state.last_sync_time.is_none());
        assert_eq!(state.synced_messages, 0);
        assert!(state.sync_error.is_none());
    }

    #[test]
    fn test_connection_state_variants() {
        let states = [
            ConnectionState::Disconnected,
            ConnectionState::Connecting,
            ConnectionState::Connected,
            ConnectionState::Syncing,
            ConnectionState::Error,
        ];
        assert_eq!(states.len(), 5);
    }

    #[test]
    fn test_connection_state_default() {
        let state = ConnectionState::default();
        assert_eq!(state, ConnectionState::Disconnected);
    }

    #[test]
    fn test_remote_session_state() {
        let state = RemoteSessionState {
            connection_state: ConnectionState::Connected,
            sync_state: SyncState::default(),
            config: TeleportConfig {
                session_id: "test".to_string(),
                ingress_url: None,
                auth_token: None,
                metadata: None,
            },
            error: None,
        };
        assert_eq!(state.connection_state, ConnectionState::Connected);
    }
}
