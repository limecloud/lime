//! Teleport 模块
//!
//! 提供远程会话连接、同步、仓库验证等功能
//!
//! ## 功能
//! - 远程会话连接（WebSocket）
//! - 消息同步
//! - 仓库验证
//! - 心跳和断线重连

mod connection;
mod session;
mod types;
mod validation;

pub use connection::{
    can_teleport_to_session, connect_to_remote_session, ConnectionConfig, ConnectionEvent,
    WebSocketManager,
};
pub use session::{create_remote_session, RemoteSession};
pub use types::{
    ConnectionState, RemoteMessage, RemoteMessageType, RemoteSessionState, RepoValidationResult,
    RepoValidationStatus, SyncState, TeleportConfig, TeleportMetadata,
};
pub use validation::{
    compare_repo_urls, get_current_branch, get_current_repo_url, is_working_directory_clean,
    normalize_repo_url, validate_session_repository,
};
