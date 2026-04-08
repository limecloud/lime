//! MCP (Model Context Protocol) Module
//!
//! This module provides enhanced MCP support for aster-rust, aligned with
//!
//! - **Connection Management**: Multi-transport support (stdio, HTTP, SSE, WebSocket),
//!   automatic reconnection, heartbeat monitoring
//! - **Configuration Management**: Global and project-level configs, validation,
//!   change notifications
//! - **Lifecycle Management**: Server process management, auto-restart, health checks
//! - **Tool Management**: Tool discovery, caching, argument validation, batch calls
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │                        Agent / CLI                               │
//! ├─────────────────────────────────────────────────────────────────┤
//! │                     ExtensionManager                             │
//! │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
//! │  │ McpConnection   │  │ McpLifecycle    │  │ McpConfig       │  │
//! │  │ Manager         │  │ Manager         │  │ Manager         │  │
//! │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
//! │           │                    │                    │           │
//! │  ┌────────┴────────────────────┴────────────────────┴────────┐  │
//! │  │                     McpToolManager                         │  │
//! │  └────────────────────────────────────────────────────────────┘  │
//! ├─────────────────────────────────────────────────────────────────┤
//! │                        Transport Layer                           │
//! │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
//! │  │  Stdio   │  │   HTTP   │  │   SSE    │  │    WebSocket     │ │
//! │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
//! └─────────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Example
//!
//! ```rust,ignore
//! use aster::mcp::{McpError, McpResult, TransportType, McpServerConfig};
//!
//! // Create a server configuration
//! let config = McpServerConfig {
//!     transport_type: TransportType::Stdio,
//!     command: Some("npx".to_string()),
//!     args: Some(vec!["-y".to_string(), "@modelcontextprotocol/server-filesystem".to_string()]),
//!     enabled: true,
//!     ..Default::default()
//! };
//! ```

pub mod cancellation;
pub mod config_manager;
pub mod connection_manager;
pub mod error;
pub mod integration;
pub mod lifecycle_manager;
pub mod logging;
pub mod notifications;
pub mod resource_manager;
pub mod roots;
pub mod tool_manager;
pub mod transport;
pub mod types;

#[cfg(test)]
mod connection_manager_tests;

#[cfg(test)]
mod config_manager_tests;

#[cfg(test)]
mod lifecycle_manager_tests;

#[cfg(test)]
mod tool_manager_tests;

#[cfg(test)]
mod resource_manager_tests;

#[cfg(test)]
mod sampling_tests;

#[cfg(test)]
mod integration_tests;

#[cfg(test)]
mod error_tests;

// Re-export commonly used types
pub use config_manager::{
    ConfigChangeCallback, ConfigEvent, ConfigManager, McpConfigFile, McpConfigManager,
};
pub use connection_manager::{
    ConnectionEvent, ConnectionManager, McpConnectionManager, PendingRequestInfo,
};
pub use error::{McpError, McpErrorCode, McpResult, StructuredError};
pub use integration::McpIntegration;
pub use lifecycle_manager::{
    LifecycleEvent, LifecycleManager, McpLifecycleManager, StartOptions, StopOptions,
};
pub use logging::{LogCallback, McpLogEntry, McpLogger};
pub use resource_manager::{
    McpResource, McpResourceManager, McpResourceTemplate, ResourceCacheEntry, ResourceContent,
    ResourceEvent, ResourceManager,
};
pub use tool_manager::{
    ArgValidationResult, CallInfo, McpTool, McpToolManager, ToolCall, ToolCallResult, ToolManager,
    ToolResultContent,
};
pub use transport::{
    BoxedTransport, HttpTransport, McpErrorData, McpMessage, McpNotification, McpRequest,
    McpResponse, SharedTransport, StdioTransport, Transport, TransportConfig, TransportEvent,
    TransportFactory, TransportState, WebSocketTransport,
};
pub use types::{
    ConfigManagerOptions, ConfigScope, ConnectionOptions, ConnectionStatus, HealthCheckResult,
    LifecycleOptions, McpConnection, McpLogLevel, McpServerConfig, McpServerInfo, ServerProcess,
    ServerState, ServerValidationResult, TransportType, ValidationResult,
};

// Re-export JSON types from rmcp
pub use types::JsonObject;

// Re-export cancellation types
pub use cancellation::{
    CancellableRequest, CancellationEvent, CancellationReason, CancellationResult,
    CancellationStats, CancellationToken, CancelledNotification, McpCancellationManager,
    RequestDuration,
};

// Re-export notification types
pub use notifications::{
    create_progress_params, McpNotificationManager, Notification, NotificationEvent,
    NotificationFilter, NotificationStats, NotificationType, ProgressNotification, ProgressState,
};

// Re-export roots types
pub use roots::{
    create_root_from_path, get_default_roots_config, McpRootsManager, Root, RootEvent, RootInfo,
    RootPermissions, RootsConfig, RootsStats,
};
