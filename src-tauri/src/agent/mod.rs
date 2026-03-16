//! AI Agent 集成模块
//!
//! 纯逻辑部分已迁移到 proxycast-agent crate，
//! 本模块保留深耦合部分（Aster 状态与 Tauri 桥接）。

pub mod aster_agent;
pub mod aster_state;
pub mod credential_bridge;
pub mod subagent_scheduler;

// 从 proxycast-agent crate re-export
pub use proxycast_agent::event_converter;
pub use proxycast_agent::mcp_bridge;
pub use proxycast_agent::prompt;

// types 已迁移到 proxycast-core
pub use proxycast_core::agent::types;
pub use proxycast_core::agent::types::*;

pub use aster_agent::{AsterAgentWrapper, SessionDetail, SessionInfo};
pub use aster_state::AsterAgentState;
pub use credential_bridge::{
    create_aster_provider, AsterProviderConfig, CredentialBridge, CredentialBridgeError,
};
pub use proxycast_agent::{
    convert_agent_event, convert_to_tauri_message, QueueInsertResult, QueuedTurnSnapshot,
    QueuedTurnTask, SessionTurnQueueManager, TauriAgentEvent,
};
pub use subagent_scheduler::{
    ProxyCastScheduler, ProxyCastSubAgentExecutor, SubAgentProgressEvent, SubAgentRole,
};
