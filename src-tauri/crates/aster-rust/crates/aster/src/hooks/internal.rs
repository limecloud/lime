//! 内部钩子事件系统
//!
//! 本模块实现内部钩子（Internal Hooks）机制，支持 Agent 生命周期、
//! Session 管理、命令处理等事件的监听和处理。
//!
//! # 事件类型
//!
//! - `Agent`: Agent 生命周期事件（启动、停止、错误、引导）
//! - `Session`: 会话事件（创建、恢复、结束、压缩）
//! - `Tool`: 工具事件（执行前、执行后、错误）
//! - `Command`: 命令事件（new、reset、status、help）
//! - `Gateway`: 网关事件（连接、断开、消息）
//!
//! # 示例
//!
//! ```rust,ignore
//! use aster::hooks::internal::{InternalHookEventType};
//!
//! let event_type = InternalHookEventType::Agent;
//! assert_eq!(event_type.to_string(), "agent");
//! ```

use anyhow::Result;
use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

/// 内部钩子事件类型
///
/// 定义系统中可监听的五种主要事件类型。每种类型对应不同的系统组件，
/// 可以与 `InternalHookAction` 组合形成具体的事件键（如 `agent:start`）。
///
/// # 序列化
///
/// 序列化时使用小写格式（如 `"agent"`、`"session"`）。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::InternalHookEventType;
///
/// let event_type = InternalHookEventType::Agent;
/// assert_eq!(event_type.to_string(), "agent");
///
/// // 序列化为 JSON
/// let json = serde_json::to_string(&event_type).unwrap();
/// assert_eq!(json, "\"agent\"");
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InternalHookEventType {
    /// Agent 生命周期事件
    ///
    /// 用于监听 Agent 的启动、停止、错误和引导完成等事件。
    Agent,

    /// Session 会话事件
    ///
    /// 用于监听会话的创建、恢复、结束和压缩等事件。
    Session,

    /// Tool 工具事件
    ///
    /// 用于监听工具调用的前后事件，与现有 hooks 系统桥接。
    Tool,

    /// Command 命令事件
    ///
    /// 用于监听用户命令（如 /new、/reset、/status、/help）的执行。
    Command,

    /// Gateway 网关事件
    ///
    /// 用于监听网关的连接、断开和消息事件。
    Gateway,
}

impl fmt::Display for InternalHookEventType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            InternalHookEventType::Agent => "agent",
            InternalHookEventType::Session => "session",
            InternalHookEventType::Tool => "tool",
            InternalHookEventType::Command => "command",
            InternalHookEventType::Gateway => "gateway",
        };
        write!(f, "{}", s)
    }
}

/// 内部钩子事件动作
///
/// 定义各种事件类型下的具体动作。不同的事件类型有不同的有效动作：
///
/// | 事件类型 | 有效动作 |
/// |---------|---------|
/// | Agent | Start, Stop, Error, Bootstrap |
/// | Session | Create, Resume, End, Compact |
/// | Tool | Before, After, Error |
/// | Command | New, Reset, Status, Help |
/// | Gateway | Connect, Disconnect, Message |
///
/// # 序列化
///
/// 序列化时使用小写格式（如 `"start"`、`"create"`）。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::InternalHookAction;
///
/// let action = InternalHookAction::Start;
/// assert_eq!(action.to_string(), "start");
///
/// // 序列化为 JSON
/// let json = serde_json::to_string(&action).unwrap();
/// assert_eq!(json, "\"start\"");
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InternalHookAction {
    // ========== Agent 动作 ==========
    /// Agent 启动
    ///
    /// 当 Agent 开始运行时触发。
    Start,

    /// Agent 停止
    ///
    /// 当 Agent 停止运行时触发。
    Stop,

    /// Agent 错误
    ///
    /// 当 Agent 发生错误时触发。也可用于 Tool 错误事件。
    Error,

    /// Agent 引导完成
    ///
    /// 当 Agent 完成初始化引导时触发。
    Bootstrap,

    // ========== Session 动作 ==========
    /// Session 创建
    ///
    /// 当新会话创建时触发。
    Create,

    /// Session 恢复
    ///
    /// 当会话从持久化状态恢复时触发。
    Resume,

    /// Session 结束
    ///
    /// 当会话结束时触发。
    End,

    /// Session 压缩
    ///
    /// 当会话历史被压缩时触发。
    Compact,

    // ========== Tool 动作 ==========
    /// Tool 执行前
    ///
    /// 在工具执行之前触发。
    Before,

    /// Tool 执行后
    ///
    /// 在工具执行之后触发。
    After,
    // 注意：Tool 错误复用上面的 Error 动作

    // ========== Command 动作 ==========
    /// /new 命令
    ///
    /// 当用户执行 /new 命令时触发。
    New,

    /// /reset 命令
    ///
    /// 当用户执行 /reset 命令时触发。
    Reset,

    /// /status 命令
    ///
    /// 当用户执行 /status 命令时触发。
    Status,

    /// /help 命令
    ///
    /// 当用户执行 /help 命令时触发。
    Help,

    // ========== Gateway 动作 ==========
    /// Gateway 连接
    ///
    /// 当网关建立连接时触发。
    Connect,

    /// Gateway 断开
    ///
    /// 当网关断开连接时触发。
    Disconnect,

    /// Gateway 消息
    ///
    /// 当网关收到或发送消息时触发。
    Message,
}

impl fmt::Display for InternalHookAction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            // Agent 动作
            InternalHookAction::Start => "start",
            InternalHookAction::Stop => "stop",
            InternalHookAction::Error => "error",
            InternalHookAction::Bootstrap => "bootstrap",
            // Session 动作
            InternalHookAction::Create => "create",
            InternalHookAction::Resume => "resume",
            InternalHookAction::End => "end",
            InternalHookAction::Compact => "compact",
            // Tool 动作
            InternalHookAction::Before => "before",
            InternalHookAction::After => "after",
            // Command 动作
            InternalHookAction::New => "new",
            InternalHookAction::Reset => "reset",
            InternalHookAction::Status => "status",
            InternalHookAction::Help => "help",
            // Gateway 动作
            InternalHookAction::Connect => "connect",
            InternalHookAction::Disconnect => "disconnect",
            InternalHookAction::Message => "message",
        };
        write!(f, "{}", s)
    }
}

/// 内部钩子事件
///
/// 表示系统中发生的一个内部事件，包含事件类型、动作、上下文数据等信息。
/// 事件可以被注册的处理器监听和处理。
///
/// # 字段
///
/// - `event_type`: 事件类型（Agent、Session、Tool、Command、Gateway）
/// - `action`: 事件动作（如 Start、Stop、Create 等）
/// - `session_key`: 可选的会话键，用于关联特定会话
/// - `context`: JSON 格式的上下文数据，包含事件相关的详细信息
/// - `timestamp`: 事件发生的 UTC 时间戳
/// - `messages`: 消息列表，处理器可以向其中推送消息
///
/// # 事件键
///
/// 事件键格式为 `type:action`（如 `agent:start`、`session:create`），
/// 用于在注册表中匹配处理器。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::{InternalHookEvent, InternalHookEventType, InternalHookAction};
/// use serde_json::json;
///
/// // 创建一个 Agent 启动事件
/// let event = InternalHookEvent::new(
///     InternalHookEventType::Agent,
///     InternalHookAction::Start,
///     Some("user:session:123".to_string()),
///     json!({
///         "agent_id": "agent-001",
///         "agent_type": "coding"
///     }),
/// );
///
/// assert_eq!(event.event_key(), "agent:start");
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalHookEvent {
    /// 事件类型
    ///
    /// 标识事件所属的系统组件类别。
    pub event_type: InternalHookEventType,

    /// 事件动作
    ///
    /// 描述事件的具体动作，如启动、停止、创建等。
    pub action: InternalHookAction,

    /// 会话键（可选）
    ///
    /// 用于关联特定会话的标识符。对于与会话相关的事件，
    /// 此字段通常包含会话的唯一标识。
    pub session_key: Option<String>,

    /// 上下文数据
    ///
    /// JSON 格式的上下文数据，包含事件相关的详细信息。
    /// 不同类型的事件有不同的上下文结构：
    ///
    /// - Agent 事件：`agent_id`、`agent_type`、`workspace_dir`、`error`
    /// - Session 事件：`session_id`、`session_key`、`source`、`reason`
    /// - Command 事件：`command_name`、`command_args`、`raw_input`
    /// - Gateway 事件：`connection_id`、`channel`、`message`
    pub context: serde_json::Value,

    /// 时间戳
    ///
    /// 事件发生的 UTC 时间戳，由 `new()` 构造函数自动填充。
    pub timestamp: DateTime<Utc>,

    /// 消息列表
    ///
    /// 处理器可以向此列表推送消息，用于向用户反馈信息。
    /// 初始为空列表。
    pub messages: Vec<String>,
}

impl InternalHookEvent {
    /// 创建新的内部钩子事件
    ///
    /// 自动填充 `timestamp` 为当前 UTC 时间，`messages` 初始化为空列表。
    ///
    /// # 参数
    ///
    /// - `event_type`: 事件类型
    /// - `action`: 事件动作
    /// - `session_key`: 可选的会话键
    /// - `context`: 上下文数据（JSON 格式）
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use aster::hooks::internal::{InternalHookEvent, InternalHookEventType, InternalHookAction};
    /// use serde_json::json;
    ///
    /// let event = InternalHookEvent::new(
    ///     InternalHookEventType::Agent,
    ///     InternalHookAction::Start,
    ///     None,
    ///     json!({"agent_id": "agent-001"}),
    /// );
    ///
    /// assert!(event.timestamp <= chrono::Utc::now());
    /// assert!(event.messages.is_empty());
    /// ```
    pub fn new(
        event_type: InternalHookEventType,
        action: InternalHookAction,
        session_key: Option<String>,
        context: serde_json::Value,
    ) -> Self {
        Self {
            event_type,
            action,
            session_key,
            context,
            timestamp: Utc::now(),
            messages: Vec::new(),
        }
    }

    /// 获取事件键
    ///
    /// 返回格式为 `type:action` 的事件键，用于在注册表中匹配处理器。
    ///
    /// # 返回值
    ///
    /// 事件键字符串，如 `"agent:start"`、`"session:create"`。
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use aster::hooks::internal::{InternalHookEvent, InternalHookEventType, InternalHookAction};
    /// use serde_json::json;
    ///
    /// let event = InternalHookEvent::new(
    ///     InternalHookEventType::Session,
    ///     InternalHookAction::Create,
    ///     None,
    ///     json!({}),
    /// );
    ///
    /// assert_eq!(event.event_key(), "session:create");
    /// ```
    pub fn event_key(&self) -> String {
        format!("{}:{}", self.event_type, self.action)
    }
}

/// 内部钩子处理器函数类型
///
/// 定义为异步函数，接收可变的事件引用，返回 `Result<()>`。
/// 处理器可以修改事件的 `messages` 字段来向用户推送消息。
///
/// # 类型签名
///
/// ```rust,ignore
/// Arc<dyn Fn(&mut InternalHookEvent) -> Pin<Box<dyn Future<Output = Result<()>> + Send>> + Send + Sync>
/// ```
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::{InternalHookHandlerFn, InternalHookEvent};
/// use std::sync::Arc;
///
/// let handler: InternalHookHandlerFn = Arc::new(|event| {
///     Box::pin(async move {
///         event.messages.push("Handler executed".to_string());
///         Ok(())
///     })
/// });
/// ```
pub type InternalHookHandlerFn = Arc<
    dyn Fn(&mut InternalHookEvent) -> Pin<Box<dyn Future<Output = Result<()>> + Send>>
        + Send
        + Sync,
>;

/// 内部钩子注册表
///
/// 管理事件与处理器的映射关系。支持按事件键（`type:action`）或
/// 事件类型（`type`）注册处理器。
///
/// # 线程安全
///
/// 使用 `RwLock` 保护内部数据结构，支持多线程并发访问。
///
/// # 事件键格式
///
/// | 注册方式 | 事件键示例 | 触发条件 |
/// |---------|-----------|---------|
/// | 类型级别 | `agent` | 所有 Agent 事件 |
/// | 动作级别 | `agent:start` | 仅 Agent Start 事件 |
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::{InternalHookRegistry, InternalHookHandlerFn};
/// use std::sync::Arc;
///
/// let registry = InternalHookRegistry::new();
///
/// // 注册处理器
/// let handler: InternalHookHandlerFn = Arc::new(|event| {
///     Box::pin(async move {
///         println!("Event: {}", event.event_key());
///         Ok(())
///     })
/// });
/// registry.register("agent:start", handler);
///
/// // 查询已注册的事件键
/// let keys = registry.get_registered_keys();
/// assert!(keys.contains(&"agent:start".to_string()));
/// ```
pub struct InternalHookRegistry {
    /// 处理器映射：event_key -> handlers
    ///
    /// 使用 `RwLock` 保护，支持多线程并发读写。
    /// 每个事件键可以注册多个处理器，按注册顺序存储。
    handlers: RwLock<HashMap<String, Vec<InternalHookHandlerFn>>>,
}

impl InternalHookRegistry {
    /// 创建新的内部钩子注册表
    ///
    /// # 返回值
    ///
    /// 返回一个空的注册表实例。
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use aster::hooks::internal::InternalHookRegistry;
    ///
    /// let registry = InternalHookRegistry::new();
    /// assert!(registry.get_registered_keys().is_empty());
    /// ```
    pub fn new() -> Self {
        Self {
            handlers: RwLock::new(HashMap::new()),
        }
    }

    /// 注册处理器
    ///
    /// 将处理器注册到指定的事件键。支持两种注册方式：
    /// - 类型级别：使用事件类型作为键（如 `"agent"`），匹配该类型的所有事件
    /// - 动作级别：使用 `type:action` 格式（如 `"agent:start"`），匹配特定事件
    ///
    /// 同一事件键可以注册多个处理器，按注册顺序调用。
    ///
    /// # 参数
    ///
    /// - `event_key`: 事件键，可以是类型（如 `"agent"`）或 `type:action` 格式
    /// - `handler`: 处理器函数
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use aster::hooks::internal::{InternalHookRegistry, InternalHookHandlerFn};
    /// use std::sync::Arc;
    ///
    /// let registry = InternalHookRegistry::new();
    ///
    /// // 注册类型级别处理器（匹配所有 Agent 事件）
    /// let type_handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
    /// registry.register("agent", type_handler);
    ///
    /// // 注册动作级别处理器（仅匹配 agent:start 事件）
    /// let action_handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
    /// registry.register("agent:start", action_handler);
    /// ```
    pub fn register(&self, event_key: &str, handler: InternalHookHandlerFn) {
        let mut handlers = self.handlers.write();
        handlers
            .entry(event_key.to_string())
            .or_default()
            .push(handler);
    }

    /// 取消注册处理器
    ///
    /// 从指定事件键中移除处理器。使用 `Arc::ptr_eq` 比较处理器指针。
    ///
    /// # 参数
    ///
    /// - `event_key`: 事件键
    /// - `handler`: 要移除的处理器
    ///
    /// # 返回值
    ///
    /// - `true`: 成功移除处理器
    /// - `false`: 未找到匹配的处理器
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use aster::hooks::internal::{InternalHookRegistry, InternalHookHandlerFn};
    /// use std::sync::Arc;
    ///
    /// let registry = InternalHookRegistry::new();
    ///
    /// let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
    /// registry.register("agent:start", handler.clone());
    ///
    /// // 取消注册
    /// let removed = registry.unregister("agent:start", &handler);
    /// assert!(removed);
    ///
    /// // 再次取消注册返回 false
    /// let removed_again = registry.unregister("agent:start", &handler);
    /// assert!(!removed_again);
    /// ```
    pub fn unregister(&self, event_key: &str, handler: &InternalHookHandlerFn) -> bool {
        let mut handlers = self.handlers.write();
        if let Some(handler_list) = handlers.get_mut(event_key) {
            let original_len = handler_list.len();
            handler_list.retain(|h| !Arc::ptr_eq(h, handler));
            let removed = handler_list.len() < original_len;

            // 如果列表为空，移除该事件键
            if handler_list.is_empty() {
                handlers.remove(event_key);
            }

            removed
        } else {
            false
        }
    }

    /// 清除所有处理器
    ///
    /// 移除注册表中的所有处理器和事件键。
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use aster::hooks::internal::{InternalHookRegistry, InternalHookHandlerFn};
    /// use std::sync::Arc;
    ///
    /// let registry = InternalHookRegistry::new();
    ///
    /// let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
    /// registry.register("agent:start", handler.clone());
    /// registry.register("session:create", handler);
    ///
    /// assert_eq!(registry.get_registered_keys().len(), 2);
    ///
    /// registry.clear();
    /// assert!(registry.get_registered_keys().is_empty());
    /// ```
    pub fn clear(&self) {
        let mut handlers = self.handlers.write();
        handlers.clear();
    }

    /// 获取已注册的事件键
    ///
    /// 返回所有已注册处理器的事件键列表。
    ///
    /// # 返回值
    ///
    /// 事件键列表，顺序不保证。
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use aster::hooks::internal::{InternalHookRegistry, InternalHookHandlerFn};
    /// use std::sync::Arc;
    ///
    /// let registry = InternalHookRegistry::new();
    ///
    /// let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
    /// registry.register("agent:start", handler.clone());
    /// registry.register("agent:stop", handler.clone());
    /// registry.register("session:create", handler);
    ///
    /// let keys = registry.get_registered_keys();
    /// assert_eq!(keys.len(), 3);
    /// assert!(keys.contains(&"agent:start".to_string()));
    /// assert!(keys.contains(&"agent:stop".to_string()));
    /// assert!(keys.contains(&"session:create".to_string()));
    /// ```
    pub fn get_registered_keys(&self) -> Vec<String> {
        let handlers = self.handlers.read();
        handlers.keys().cloned().collect()
    }

    /// 获取指定事件键的处理器列表
    ///
    /// 返回注册到指定事件键的所有处理器的克隆列表。
    /// 此方法主要用于内部触发事件时获取处理器。
    ///
    /// # 参数
    ///
    /// - `event_key`: 事件键
    ///
    /// # 返回值
    ///
    /// 处理器列表，如果没有注册任何处理器则返回空列表。
    pub fn get_handlers(&self, event_key: &str) -> Vec<InternalHookHandlerFn> {
        let handlers = self.handlers.read();
        handlers.get(event_key).cloned().unwrap_or_default()
    }

    /// 触发事件
    ///
    /// 先调用类型级别处理器（如 `"agent"`），再调用动作级别处理器（如 `"agent:start"`）。
    /// 处理器错误会被捕获并记录日志，不影响其他处理器执行。
    ///
    /// # 执行顺序
    ///
    /// 1. 获取类型级别处理器（使用 `event.event_type.to_string()` 作为键）
    /// 2. 获取动作级别处理器（使用 `event.event_key()` 作为键）
    /// 3. 按注册顺序依次调用所有处理器
    ///
    /// # 错误处理
    ///
    /// - 处理器返回 `Err`: 记录错误日志，继续执行下一个处理器
    /// - 处理器超时: 记录警告日志，继续执行下一个处理器
    ///
    /// # 参数
    ///
    /// - `event`: 可变的事件引用，处理器可以修改事件的 `messages` 字段
    ///
    /// # 返回值
    ///
    /// 始终返回 `Ok(())`，处理器错误不会导致整体失败。
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use aster::hooks::internal::{InternalHookRegistry, InternalHookEvent, InternalHookEventType, InternalHookAction, InternalHookHandlerFn};
    /// use std::sync::Arc;
    /// use serde_json::json;
    ///
    /// let registry = InternalHookRegistry::new();
    ///
    /// // 注册类型级别处理器
    /// let type_handler: InternalHookHandlerFn = Arc::new(|event| {
    ///     Box::pin(async move {
    ///         event.messages.push("Type handler called".to_string());
    ///         Ok(())
    ///     })
    /// });
    /// registry.register("agent", type_handler);
    ///
    /// // 注册动作级别处理器
    /// let action_handler: InternalHookHandlerFn = Arc::new(|event| {
    ///     Box::pin(async move {
    ///         event.messages.push("Action handler called".to_string());
    ///         Ok(())
    ///     })
    /// });
    /// registry.register("agent:start", action_handler);
    ///
    /// // 触发事件
    /// let mut event = InternalHookEvent::new(
    ///     InternalHookEventType::Agent,
    ///     InternalHookAction::Start,
    ///     None,
    ///     json!({}),
    /// );
    ///
    /// // 在异步上下文中调用
    /// // registry.trigger(&mut event).await.unwrap();
    /// // assert_eq!(event.messages, vec!["Type handler called", "Action handler called"]);
    /// ```
    pub async fn trigger(&self, event: &mut InternalHookEvent) -> Result<()> {
        use std::time::Duration;
        use tokio::time::timeout;
        use tracing::{debug, error, warn};

        // 默认处理器超时时间：30 秒
        const HANDLER_TIMEOUT: Duration = Duration::from_secs(30);

        let type_key = event.event_type.to_string();
        let action_key = event.event_key();

        debug!(
            event_type = %type_key,
            action_key = %action_key,
            "Triggering internal hook event"
        );

        // 获取类型级别处理器
        let type_handlers = self.get_handlers(&type_key);
        // 获取动作级别处理器
        let action_handlers = self.get_handlers(&action_key);

        // 如果没有任何处理器，静默返回
        if type_handlers.is_empty() && action_handlers.is_empty() {
            debug!(
                event_type = %type_key,
                action_key = %action_key,
                "No handlers registered for event, skipping"
            );
            return Ok(());
        }

        // 先调用类型级别处理器
        for (index, handler) in type_handlers.iter().enumerate() {
            debug!(
                event_type = %type_key,
                handler_index = index,
                "Calling type-level handler"
            );

            match timeout(HANDLER_TIMEOUT, handler(event)).await {
                Ok(Ok(())) => {
                    debug!(
                        event_type = %type_key,
                        handler_index = index,
                        "Type-level handler completed successfully"
                    );
                }
                Ok(Err(e)) => {
                    error!(
                        event_type = %type_key,
                        handler_index = index,
                        error = %e,
                        "Type-level handler failed with error"
                    );
                    // 继续执行下一个处理器
                }
                Err(_) => {
                    warn!(
                        event_type = %type_key,
                        handler_index = index,
                        timeout_secs = HANDLER_TIMEOUT.as_secs(),
                        "Type-level handler timed out"
                    );
                    // 继续执行下一个处理器
                }
            }
        }

        // 再调用动作级别处理器
        for (index, handler) in action_handlers.iter().enumerate() {
            debug!(
                action_key = %action_key,
                handler_index = index,
                "Calling action-level handler"
            );

            match timeout(HANDLER_TIMEOUT, handler(event)).await {
                Ok(Ok(())) => {
                    debug!(
                        action_key = %action_key,
                        handler_index = index,
                        "Action-level handler completed successfully"
                    );
                }
                Ok(Err(e)) => {
                    error!(
                        action_key = %action_key,
                        handler_index = index,
                        error = %e,
                        "Action-level handler failed with error"
                    );
                    // 继续执行下一个处理器
                }
                Err(_) => {
                    warn!(
                        action_key = %action_key,
                        handler_index = index,
                        timeout_secs = HANDLER_TIMEOUT.as_secs(),
                        "Action-level handler timed out"
                    );
                    // 继续执行下一个处理器
                }
            }
        }

        debug!(
            event_type = %type_key,
            action_key = %action_key,
            type_handler_count = type_handlers.len(),
            action_handler_count = action_handlers.len(),
            "Internal hook event trigger completed"
        );

        Ok(())
    }

    /// 检查是否有注册的处理器
    ///
    /// # 返回值
    ///
    /// - `true`: 注册表为空
    /// - `false`: 有注册的处理器
    pub fn is_empty(&self) -> bool {
        let handlers = self.handlers.read();
        handlers.is_empty()
    }

    /// 获取注册的处理器总数
    ///
    /// # 返回值
    ///
    /// 所有事件键下注册的处理器总数。
    pub fn handler_count(&self) -> usize {
        let handlers = self.handlers.read();
        handlers.values().map(|v| v.len()).sum()
    }
}

impl Default for InternalHookRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for InternalHookRegistry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let handlers = self.handlers.read();
        let keys: Vec<_> = handlers.keys().collect();
        let counts: HashMap<_, _> = handlers.iter().map(|(k, v)| (k, v.len())).collect();
        f.debug_struct("InternalHookRegistry")
            .field("registered_keys", &keys)
            .field("handler_counts", &counts)
            .finish()
    }
}

// ============================================================================
// 全局注册表单例
// ============================================================================

/// 全局内部钩子注册表
///
/// 使用 `once_cell::sync::Lazy` 实现的全局单例，在首次访问时初始化。
/// 整个应用程序共享同一个注册表实例。
static GLOBAL_INTERNAL_REGISTRY: Lazy<InternalHookRegistry> = Lazy::new(InternalHookRegistry::new);

/// 获取全局内部钩子注册表
///
/// 返回全局共享的 `InternalHookRegistry` 实例的静态引用。
/// 此函数是线程安全的，可以在任何地方调用。
///
/// # 返回值
///
/// 返回全局 `InternalHookRegistry` 实例的静态引用。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::{global_internal_registry, InternalHookHandlerFn};
/// use std::sync::Arc;
///
/// // 获取全局注册表
/// let registry = global_internal_registry();
///
/// // 注册处理器
/// let handler: InternalHookHandlerFn = Arc::new(|event| {
///     Box::pin(async move {
///         println!("Event: {}", event.event_key());
///         Ok(())
///     })
/// });
/// registry.register("agent:start", handler);
///
/// // 查询已注册的事件键
/// let keys = registry.get_registered_keys();
/// assert!(keys.contains(&"agent:start".to_string()));
/// ```
///
/// # 线程安全
///
/// 此函数返回的引用是线程安全的，`InternalHookRegistry` 内部使用
/// `RwLock` 保护数据结构，支持多线程并发访问。
pub fn global_internal_registry() -> &'static InternalHookRegistry {
    &GLOBAL_INTERNAL_REGISTRY
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 创建内部钩子事件
///
/// 这是一个便捷函数，用于创建 `InternalHookEvent` 实例。
/// 内部调用 `InternalHookEvent::new()` 构造函数。
///
/// # 参数
///
/// - `event_type`: 事件类型
/// - `action`: 事件动作
/// - `session_key`: 可选的会话键
/// - `context`: 上下文数据（JSON 格式）
///
/// # 返回值
///
/// 返回新创建的 `InternalHookEvent` 实例。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::{
///     create_internal_hook_event, InternalHookEventType, InternalHookAction
/// };
/// use serde_json::json;
///
/// let event = create_internal_hook_event(
///     InternalHookEventType::Agent,
///     InternalHookAction::Start,
///     Some("session-123".to_string()),
///     json!({"agent_id": "agent-001"}),
/// );
///
/// assert_eq!(event.event_key(), "agent:start");
/// ```
pub fn create_internal_hook_event(
    event_type: InternalHookEventType,
    action: InternalHookAction,
    session_key: Option<String>,
    context: serde_json::Value,
) -> InternalHookEvent {
    InternalHookEvent::new(event_type, action, session_key, context)
}

/// 触发内部钩子事件（使用全局注册表）
///
/// 这是一个便捷函数，使用全局注册表触发事件。
/// 先调用类型级别处理器，再调用动作级别处理器。
///
/// # 参数
///
/// - `event`: 可变的事件引用，处理器可以修改事件的 `messages` 字段
///
/// # 返回值
///
/// 始终返回 `Ok(())`，处理器错误不会导致整体失败。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::{
///     trigger_internal_hook, create_internal_hook_event,
///     InternalHookEventType, InternalHookAction
/// };
/// use serde_json::json;
///
/// async fn example() {
///     let mut event = create_internal_hook_event(
///         InternalHookEventType::Agent,
///         InternalHookAction::Start,
///         None,
///         json!({"agent_id": "agent-001"}),
///     );
///
///     trigger_internal_hook(&mut event).await.unwrap();
///     println!("Messages: {:?}", event.messages);
/// }
/// ```
pub async fn trigger_internal_hook(event: &mut InternalHookEvent) -> Result<()> {
    global_internal_registry().trigger(event).await
}

/// 注册内部钩子处理器（使用全局注册表）
///
/// 这是一个便捷函数，将处理器注册到全局注册表。
/// 支持类型级别（如 `"agent"`）和动作级别（如 `"agent:start"`）注册。
///
/// # 参数
///
/// - `event_key`: 事件键，可以是类型或 `type:action` 格式
/// - `handler`: 处理器函数
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::{register_internal_hook, InternalHookHandlerFn};
/// use std::sync::Arc;
///
/// // 注册动作级别处理器
/// let handler: InternalHookHandlerFn = Arc::new(|event| {
///     Box::pin(async move {
///         event.messages.push("Handler executed".to_string());
///         Ok(())
///     })
/// });
/// register_internal_hook("agent:start", handler);
///
/// // 注册类型级别处理器（匹配所有 Agent 事件）
/// let type_handler: InternalHookHandlerFn = Arc::new(|_| {
///     Box::pin(async move { Ok(()) })
/// });
/// register_internal_hook("agent", type_handler);
/// ```
pub fn register_internal_hook(event_key: &str, handler: InternalHookHandlerFn) {
    global_internal_registry().register(event_key, handler);
}

/// 取消注册内部钩子处理器（使用全局注册表）
///
/// 这是一个便捷函数，从全局注册表中移除处理器。
/// 使用 `Arc::ptr_eq` 比较处理器指针。
///
/// # 参数
///
/// - `event_key`: 事件键
/// - `handler`: 要移除的处理器
///
/// # 返回值
///
/// - `true`: 成功移除处理器
/// - `false`: 未找到匹配的处理器
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::{
///     register_internal_hook, unregister_internal_hook, InternalHookHandlerFn
/// };
/// use std::sync::Arc;
///
/// let handler: InternalHookHandlerFn = Arc::new(|_| {
///     Box::pin(async move { Ok(()) })
/// });
///
/// // 注册处理器
/// register_internal_hook("agent:start", handler.clone());
///
/// // 取消注册
/// let removed = unregister_internal_hook("agent:start", &handler);
/// assert!(removed);
/// ```
pub fn unregister_internal_hook(event_key: &str, handler: &InternalHookHandlerFn) -> bool {
    global_internal_registry().unregister(event_key, handler)
}

/// 清除所有内部钩子处理器（使用全局注册表）
///
/// 这是一个便捷函数，清除全局注册表中的所有处理器。
/// 主要用于测试清理或应用程序重置。
///
/// # 警告
///
/// 此操作会移除所有已注册的处理器，请谨慎使用。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::{
///     register_internal_hook, clear_internal_hooks,
///     global_internal_registry, InternalHookHandlerFn
/// };
/// use std::sync::Arc;
///
/// let handler: InternalHookHandlerFn = Arc::new(|_| {
///     Box::pin(async move { Ok(()) })
/// });
///
/// register_internal_hook("agent:start", handler.clone());
/// register_internal_hook("session:create", handler);
///
/// // 清除所有处理器
/// clear_internal_hooks();
///
/// assert!(global_internal_registry().is_empty());
/// ```
pub fn clear_internal_hooks() {
    global_internal_registry().clear();
}

// ============================================================================
// Agent 事件辅助函数
// ============================================================================

/// 触发 agent:start 事件
///
/// 当 Agent 启动时调用此函数触发 `agent:start` 事件。
/// 事件的 context 包含 `agent_id` 和 `agent_type` 字段。
///
/// # 参数
///
/// - `agent_id`: Agent 的唯一标识符
/// - `agent_type`: Agent 的类型（如 "coding"、"chat" 等）
/// - `session_key`: 可选的会话键
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_agent_start;
///
/// async fn start_agent() {
///     let event = trigger_agent_start(
///         "agent-001",
///         "coding",
///         Some("session-123".to_string()),
///     ).await.unwrap();
///
///     // 检查处理器添加的消息
///     for msg in &event.messages {
///         println!("Handler message: {}", msg);
///     }
/// }
/// ```
///
/// **Validates: Requirements 7.1, 7.5**
pub async fn trigger_agent_start(
    agent_id: &str,
    agent_type: &str,
    session_key: Option<String>,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Agent,
        InternalHookAction::Start,
        session_key,
        serde_json::json!({
            "agent_id": agent_id,
            "agent_type": agent_type
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

/// 触发 agent:stop 事件
///
/// 当 Agent 停止时调用此函数触发 `agent:stop` 事件。
/// 事件的 context 包含 `agent_id` 和 `agent_type` 字段。
///
/// # 参数
///
/// - `agent_id`: Agent 的唯一标识符
/// - `agent_type`: Agent 的类型（如 "coding"、"chat" 等）
/// - `session_key`: 可选的会话键
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_agent_stop;
///
/// async fn stop_agent() {
///     let event = trigger_agent_stop(
///         "agent-001",
///         "coding",
///         Some("session-123".to_string()),
///     ).await.unwrap();
///
///     println!("Agent stopped, messages: {:?}", event.messages);
/// }
/// ```
///
/// **Validates: Requirements 7.2, 7.5**
pub async fn trigger_agent_stop(
    agent_id: &str,
    agent_type: &str,
    session_key: Option<String>,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Agent,
        InternalHookAction::Stop,
        session_key,
        serde_json::json!({
            "agent_id": agent_id,
            "agent_type": agent_type
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

/// 触发 agent:error 事件
///
/// 当 Agent 发生错误时调用此函数触发 `agent:error` 事件。
/// 事件的 context 包含 `agent_id`、`agent_type` 和 `error` 字段。
///
/// # 参数
///
/// - `agent_id`: Agent 的唯一标识符
/// - `agent_type`: Agent 的类型（如 "coding"、"chat" 等）
/// - `error`: 错误信息
/// - `session_key`: 可选的会话键
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_agent_error;
///
/// async fn handle_agent_error() {
///     let event = trigger_agent_error(
///         "agent-001",
///         "coding",
///         "Connection timeout",
///         Some("session-123".to_string()),
///     ).await.unwrap();
///
///     println!("Error event triggered, messages: {:?}", event.messages);
/// }
/// ```
///
/// **Validates: Requirements 7.3, 7.5**
pub async fn trigger_agent_error(
    agent_id: &str,
    agent_type: &str,
    error: &str,
    session_key: Option<String>,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Agent,
        InternalHookAction::Error,
        session_key,
        serde_json::json!({
            "agent_id": agent_id,
            "agent_type": agent_type,
            "error": error
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

/// 触发 agent:bootstrap 事件
///
/// 当 Agent 完成初始化引导时调用此函数触发 `agent:bootstrap` 事件。
/// 事件的 context 包含 `agent_id` 和 `agent_type` 字段。
///
/// # 参数
///
/// - `agent_id`: Agent 的唯一标识符
/// - `agent_type`: Agent 的类型（如 "coding"、"chat" 等）
/// - `session_key`: 可选的会话键
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_agent_bootstrap;
///
/// async fn bootstrap_agent() {
///     let event = trigger_agent_bootstrap(
///         "agent-001",
///         "coding",
///         Some("session-123".to_string()),
///     ).await.unwrap();
///
///     println!("Bootstrap complete, messages: {:?}", event.messages);
/// }
/// ```
///
/// **Validates: Requirements 7.4, 7.5**
pub async fn trigger_agent_bootstrap(
    agent_id: &str,
    agent_type: &str,
    session_key: Option<String>,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Agent,
        InternalHookAction::Bootstrap,
        session_key,
        serde_json::json!({
            "agent_id": agent_id,
            "agent_type": agent_type
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

// ============================================================================
// Session 事件辅助函数
// ============================================================================

/// 触发 session:create 事件
///
/// 当 Session 创建时调用此函数触发 `session:create` 事件。
/// 事件的 context 包含 `session_id` 和 `session_key` 字段。
///
/// # 参数
///
/// - `session_id`: Session 的唯一标识符
/// - `session_key`: Session 的键（用于存储和检索）
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_session_create;
///
/// async fn create_session() {
///     let event = trigger_session_create(
///         "session-001",
///         "user:session:123",
///     ).await.unwrap();
///
///     // 检查处理器添加的消息
///     for msg in &event.messages {
///         println!("Handler message: {}", msg);
///     }
/// }
/// ```
///
/// **Validates: Requirements 8.1, 8.5**
pub async fn trigger_session_create(
    session_id: &str,
    session_key: &str,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Session,
        InternalHookAction::Create,
        Some(session_key.to_string()),
        serde_json::json!({
            "session_id": session_id,
            "session_key": session_key,
            "source": "startup"
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

/// 触发 session:resume 事件
///
/// 当 Session 恢复时调用此函数触发 `session:resume` 事件。
/// 事件的 context 包含 `session_id` 和 `session_key` 字段。
///
/// # 参数
///
/// - `session_id`: Session 的唯一标识符
/// - `session_key`: Session 的键（用于存储和检索）
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_session_resume;
///
/// async fn resume_session() {
///     let event = trigger_session_resume(
///         "session-001",
///         "user:session:123",
///     ).await.unwrap();
///
///     println!("Session resumed, messages: {:?}", event.messages);
/// }
/// ```
///
/// **Validates: Requirements 8.2, 8.5**
pub async fn trigger_session_resume(
    session_id: &str,
    session_key: &str,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Session,
        InternalHookAction::Resume,
        Some(session_key.to_string()),
        serde_json::json!({
            "session_id": session_id,
            "session_key": session_key,
            "source": "resume"
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

/// 触发 session:end 事件
///
/// 当 Session 结束时调用此函数触发 `session:end` 事件。
/// 事件的 context 包含 `session_id`、`session_key` 和可选的 `reason` 字段。
///
/// # 参数
///
/// - `session_id`: Session 的唯一标识符
/// - `session_key`: Session 的键（用于存储和检索）
/// - `reason`: 可选的结束原因（如 "clear"、"logout"、"exit"、"other"）
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_session_end;
///
/// async fn end_session() {
///     let event = trigger_session_end(
///         "session-001",
///         "user:session:123",
///         Some("logout"),
///     ).await.unwrap();
///
///     println!("Session ended, messages: {:?}", event.messages);
/// }
/// ```
///
/// **Validates: Requirements 8.3, 8.5**
pub async fn trigger_session_end(
    session_id: &str,
    session_key: &str,
    reason: Option<&str>,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Session,
        InternalHookAction::End,
        Some(session_key.to_string()),
        serde_json::json!({
            "session_id": session_id,
            "session_key": session_key,
            "source": "clear",
            "reason": reason.unwrap_or("other")
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

/// 触发 session:compact 事件
///
/// 当 Session 压缩时调用此函数触发 `session:compact` 事件。
/// 事件的 context 包含 `session_id` 和 `session_key` 字段。
///
/// # 参数
///
/// - `session_id`: Session 的唯一标识符
/// - `session_key`: Session 的键（用于存储和检索）
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_session_compact;
///
/// async fn compact_session() {
///     let event = trigger_session_compact(
///         "session-001",
///         "user:session:123",
///     ).await.unwrap();
///
///     println!("Session compacted, messages: {:?}", event.messages);
/// }
/// ```
///
/// **Validates: Requirements 8.4, 8.5**
pub async fn trigger_session_compact(
    session_id: &str,
    session_key: &str,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Session,
        InternalHookAction::Compact,
        Some(session_key.to_string()),
        serde_json::json!({
            "session_id": session_id,
            "session_key": session_key,
            "source": "compact"
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

// ============================================================================
// Command 事件辅助函数
// ============================================================================

/// 触发 command:new 事件
///
/// 当用户执行 /new 命令时调用此函数触发 `command:new` 事件。
/// 事件的 context 包含 `command_name`、`command_args` 和 `raw_input` 字段。
///
/// # 参数
///
/// - `command_args`: 命令参数列表（如 `["--model", "gpt-4"]`）
/// - `raw_input`: 原始输入字符串（如 `/new --model gpt-4`）
/// - `session_key`: 可选的会话键
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_command_new;
///
/// async fn handle_new_command() {
///     let event = trigger_command_new(
///         &["--model".to_string(), "gpt-4".to_string()],
///         "/new --model gpt-4",
///         Some("session-123".to_string()),
///     ).await.unwrap();
///
///     // 检查处理器添加的消息
///     for msg in &event.messages {
///         println!("Handler message: {}", msg);
///     }
/// }
/// ```
///
/// **Validates: Requirements 9.1, 9.5**
pub async fn trigger_command_new(
    command_args: &[String],
    raw_input: &str,
    session_key: Option<String>,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Command,
        InternalHookAction::New,
        session_key,
        serde_json::json!({
            "command_name": "new",
            "command_args": command_args,
            "raw_input": raw_input
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

/// 触发 command:reset 事件
///
/// 当用户执行 /reset 命令时调用此函数触发 `command:reset` 事件。
/// 事件的 context 包含 `command_name`、`command_args` 和 `raw_input` 字段。
///
/// # 参数
///
/// - `command_args`: 命令参数列表
/// - `raw_input`: 原始输入字符串（如 `/reset`）
/// - `session_key`: 可选的会话键
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_command_reset;
///
/// async fn handle_reset_command() {
///     let event = trigger_command_reset(
///         &[],
///         "/reset",
///         Some("session-123".to_string()),
///     ).await.unwrap();
///
///     println!("Reset command triggered, messages: {:?}", event.messages);
/// }
/// ```
///
/// **Validates: Requirements 9.2, 9.5**
pub async fn trigger_command_reset(
    command_args: &[String],
    raw_input: &str,
    session_key: Option<String>,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Command,
        InternalHookAction::Reset,
        session_key,
        serde_json::json!({
            "command_name": "reset",
            "command_args": command_args,
            "raw_input": raw_input
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

/// 触发 command:status 事件
///
/// 当用户执行 /status 命令时调用此函数触发 `command:status` 事件。
/// 事件的 context 包含 `command_name`、`command_args` 和 `raw_input` 字段。
///
/// # 参数
///
/// - `command_args`: 命令参数列表
/// - `raw_input`: 原始输入字符串（如 `/status`）
/// - `session_key`: 可选的会话键
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_command_status;
///
/// async fn handle_status_command() {
///     let event = trigger_command_status(
///         &[],
///         "/status",
///         Some("session-123".to_string()),
///     ).await.unwrap();
///
///     println!("Status command triggered, messages: {:?}", event.messages);
/// }
/// ```
///
/// **Validates: Requirements 9.3, 9.5**
pub async fn trigger_command_status(
    command_args: &[String],
    raw_input: &str,
    session_key: Option<String>,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Command,
        InternalHookAction::Status,
        session_key,
        serde_json::json!({
            "command_name": "status",
            "command_args": command_args,
            "raw_input": raw_input
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

/// 触发 command:help 事件
///
/// 当用户执行 /help 命令时调用此函数触发 `command:help` 事件。
/// 事件的 context 包含 `command_name`、`command_args` 和 `raw_input` 字段。
///
/// # 参数
///
/// - `command_args`: 命令参数列表（如 `["new"]` 表示查看 new 命令的帮助）
/// - `raw_input`: 原始输入字符串（如 `/help new`）
/// - `session_key`: 可选的会话键
///
/// # 返回值
///
/// 返回触发后的 `InternalHookEvent`，调用者可以访问处理器添加的消息。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::hooks::internal::trigger_command_help;
///
/// async fn handle_help_command() {
///     let event = trigger_command_help(
///         &["new".to_string()],
///         "/help new",
///         Some("session-123".to_string()),
///     ).await.unwrap();
///
///     println!("Help command triggered, messages: {:?}", event.messages);
/// }
/// ```
///
/// **Validates: Requirements 9.4, 9.5**
pub async fn trigger_command_help(
    command_args: &[String],
    raw_input: &str,
    session_key: Option<String>,
) -> Result<InternalHookEvent> {
    let mut event = create_internal_hook_event(
        InternalHookEventType::Command,
        InternalHookAction::Help,
        session_key,
        serde_json::json!({
            "command_name": "help",
            "command_args": command_args,
            "raw_input": raw_input
        }),
    );

    trigger_internal_hook(&mut event).await?;

    Ok(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[test]
    fn test_internal_hook_event_type_display() {
        assert_eq!(InternalHookEventType::Agent.to_string(), "agent");
        assert_eq!(InternalHookEventType::Session.to_string(), "session");
        assert_eq!(InternalHookEventType::Tool.to_string(), "tool");
        assert_eq!(InternalHookEventType::Command.to_string(), "command");
        assert_eq!(InternalHookEventType::Gateway.to_string(), "gateway");
    }

    #[test]
    fn test_internal_hook_event_type_serialize() {
        assert_eq!(
            serde_json::to_string(&InternalHookEventType::Agent).unwrap(),
            "\"agent\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookEventType::Session).unwrap(),
            "\"session\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookEventType::Tool).unwrap(),
            "\"tool\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookEventType::Command).unwrap(),
            "\"command\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookEventType::Gateway).unwrap(),
            "\"gateway\""
        );
    }

    #[test]
    fn test_internal_hook_event_type_deserialize() {
        assert_eq!(
            serde_json::from_str::<InternalHookEventType>("\"agent\"").unwrap(),
            InternalHookEventType::Agent
        );
        assert_eq!(
            serde_json::from_str::<InternalHookEventType>("\"session\"").unwrap(),
            InternalHookEventType::Session
        );
        assert_eq!(
            serde_json::from_str::<InternalHookEventType>("\"tool\"").unwrap(),
            InternalHookEventType::Tool
        );
        assert_eq!(
            serde_json::from_str::<InternalHookEventType>("\"command\"").unwrap(),
            InternalHookEventType::Command
        );
        assert_eq!(
            serde_json::from_str::<InternalHookEventType>("\"gateway\"").unwrap(),
            InternalHookEventType::Gateway
        );
    }

    #[test]
    fn test_internal_hook_event_type_roundtrip() {
        let types = [
            InternalHookEventType::Agent,
            InternalHookEventType::Session,
            InternalHookEventType::Tool,
            InternalHookEventType::Command,
            InternalHookEventType::Gateway,
        ];

        for event_type in types {
            let json = serde_json::to_string(&event_type).unwrap();
            let deserialized: InternalHookEventType = serde_json::from_str(&json).unwrap();
            assert_eq!(event_type, deserialized);
        }
    }

    #[test]
    fn test_internal_hook_event_type_clone_copy() {
        let original = InternalHookEventType::Agent;
        let copied1 = original; // Copy trait
        let copied2 = original; // Copy trait

        assert_eq!(original, copied1);
        assert_eq!(original, copied2);
    }

    #[test]
    fn test_internal_hook_event_type_hash() {
        use std::collections::HashSet;

        let mut set = HashSet::new();
        set.insert(InternalHookEventType::Agent);
        set.insert(InternalHookEventType::Session);
        set.insert(InternalHookEventType::Tool);
        set.insert(InternalHookEventType::Command);
        set.insert(InternalHookEventType::Gateway);

        assert_eq!(set.len(), 5);
        assert!(set.contains(&InternalHookEventType::Agent));
        assert!(set.contains(&InternalHookEventType::Session));
        assert!(set.contains(&InternalHookEventType::Tool));
        assert!(set.contains(&InternalHookEventType::Command));
        assert!(set.contains(&InternalHookEventType::Gateway));
    }

    #[test]
    fn test_internal_hook_event_type_eq() {
        assert_eq!(InternalHookEventType::Agent, InternalHookEventType::Agent);
        assert_ne!(InternalHookEventType::Agent, InternalHookEventType::Session);
    }

    #[test]
    fn test_internal_hook_event_type_debug() {
        let debug_str = format!("{:?}", InternalHookEventType::Agent);
        assert_eq!(debug_str, "Agent");
    }

    // ========== InternalHookAction 测试 ==========

    #[test]
    fn test_internal_hook_action_display() {
        // Agent 动作
        assert_eq!(InternalHookAction::Start.to_string(), "start");
        assert_eq!(InternalHookAction::Stop.to_string(), "stop");
        assert_eq!(InternalHookAction::Error.to_string(), "error");
        assert_eq!(InternalHookAction::Bootstrap.to_string(), "bootstrap");

        // Session 动作
        assert_eq!(InternalHookAction::Create.to_string(), "create");
        assert_eq!(InternalHookAction::Resume.to_string(), "resume");
        assert_eq!(InternalHookAction::End.to_string(), "end");
        assert_eq!(InternalHookAction::Compact.to_string(), "compact");

        // Tool 动作
        assert_eq!(InternalHookAction::Before.to_string(), "before");
        assert_eq!(InternalHookAction::After.to_string(), "after");

        // Command 动作
        assert_eq!(InternalHookAction::New.to_string(), "new");
        assert_eq!(InternalHookAction::Reset.to_string(), "reset");
        assert_eq!(InternalHookAction::Status.to_string(), "status");
        assert_eq!(InternalHookAction::Help.to_string(), "help");

        // Gateway 动作
        assert_eq!(InternalHookAction::Connect.to_string(), "connect");
        assert_eq!(InternalHookAction::Disconnect.to_string(), "disconnect");
        assert_eq!(InternalHookAction::Message.to_string(), "message");
    }

    #[test]
    fn test_internal_hook_action_display_all_lowercase() {
        // 验证所有动作的 Display 输出都是小写
        let actions = [
            InternalHookAction::Start,
            InternalHookAction::Stop,
            InternalHookAction::Error,
            InternalHookAction::Bootstrap,
            InternalHookAction::Create,
            InternalHookAction::Resume,
            InternalHookAction::End,
            InternalHookAction::Compact,
            InternalHookAction::Before,
            InternalHookAction::After,
            InternalHookAction::New,
            InternalHookAction::Reset,
            InternalHookAction::Status,
            InternalHookAction::Help,
            InternalHookAction::Connect,
            InternalHookAction::Disconnect,
            InternalHookAction::Message,
        ];

        for action in actions {
            let s = action.to_string();
            assert!(
                s.chars().all(|c| c.is_lowercase() || !c.is_alphabetic()),
                "Action {:?} should have lowercase display, got: {}",
                action,
                s
            );
        }
    }

    #[test]
    fn test_internal_hook_action_serialize() {
        // Agent 动作
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Start).unwrap(),
            "\"start\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Stop).unwrap(),
            "\"stop\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Error).unwrap(),
            "\"error\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Bootstrap).unwrap(),
            "\"bootstrap\""
        );

        // Session 动作
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Create).unwrap(),
            "\"create\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Resume).unwrap(),
            "\"resume\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::End).unwrap(),
            "\"end\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Compact).unwrap(),
            "\"compact\""
        );

        // Tool 动作
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Before).unwrap(),
            "\"before\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::After).unwrap(),
            "\"after\""
        );

        // Command 动作
        assert_eq!(
            serde_json::to_string(&InternalHookAction::New).unwrap(),
            "\"new\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Reset).unwrap(),
            "\"reset\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Status).unwrap(),
            "\"status\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Help).unwrap(),
            "\"help\""
        );

        // Gateway 动作
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Connect).unwrap(),
            "\"connect\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Disconnect).unwrap(),
            "\"disconnect\""
        );
        assert_eq!(
            serde_json::to_string(&InternalHookAction::Message).unwrap(),
            "\"message\""
        );
    }

    #[test]
    fn test_internal_hook_action_deserialize() {
        // Agent 动作
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"start\"").unwrap(),
            InternalHookAction::Start
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"stop\"").unwrap(),
            InternalHookAction::Stop
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"error\"").unwrap(),
            InternalHookAction::Error
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"bootstrap\"").unwrap(),
            InternalHookAction::Bootstrap
        );

        // Session 动作
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"create\"").unwrap(),
            InternalHookAction::Create
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"resume\"").unwrap(),
            InternalHookAction::Resume
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"end\"").unwrap(),
            InternalHookAction::End
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"compact\"").unwrap(),
            InternalHookAction::Compact
        );

        // Tool 动作
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"before\"").unwrap(),
            InternalHookAction::Before
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"after\"").unwrap(),
            InternalHookAction::After
        );

        // Command 动作
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"new\"").unwrap(),
            InternalHookAction::New
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"reset\"").unwrap(),
            InternalHookAction::Reset
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"status\"").unwrap(),
            InternalHookAction::Status
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"help\"").unwrap(),
            InternalHookAction::Help
        );

        // Gateway 动作
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"connect\"").unwrap(),
            InternalHookAction::Connect
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"disconnect\"").unwrap(),
            InternalHookAction::Disconnect
        );
        assert_eq!(
            serde_json::from_str::<InternalHookAction>("\"message\"").unwrap(),
            InternalHookAction::Message
        );
    }

    #[test]
    fn test_internal_hook_action_roundtrip() {
        let actions = [
            InternalHookAction::Start,
            InternalHookAction::Stop,
            InternalHookAction::Error,
            InternalHookAction::Bootstrap,
            InternalHookAction::Create,
            InternalHookAction::Resume,
            InternalHookAction::End,
            InternalHookAction::Compact,
            InternalHookAction::Before,
            InternalHookAction::After,
            InternalHookAction::New,
            InternalHookAction::Reset,
            InternalHookAction::Status,
            InternalHookAction::Help,
            InternalHookAction::Connect,
            InternalHookAction::Disconnect,
            InternalHookAction::Message,
        ];

        for action in actions {
            let json = serde_json::to_string(&action).unwrap();
            let deserialized: InternalHookAction = serde_json::from_str(&json).unwrap();
            assert_eq!(action, deserialized);
        }
    }

    #[test]
    fn test_internal_hook_action_clone_copy() {
        let original = InternalHookAction::Start;
        let copied1 = original; // Copy trait
        let copied2 = original; // Copy trait

        assert_eq!(original, copied1);
        assert_eq!(original, copied2);
    }

    #[test]
    fn test_internal_hook_action_hash() {
        use std::collections::HashSet;

        let mut set = HashSet::new();
        set.insert(InternalHookAction::Start);
        set.insert(InternalHookAction::Stop);
        set.insert(InternalHookAction::Error);
        set.insert(InternalHookAction::Bootstrap);
        set.insert(InternalHookAction::Create);
        set.insert(InternalHookAction::Resume);
        set.insert(InternalHookAction::End);
        set.insert(InternalHookAction::Compact);
        set.insert(InternalHookAction::Before);
        set.insert(InternalHookAction::After);
        set.insert(InternalHookAction::New);
        set.insert(InternalHookAction::Reset);
        set.insert(InternalHookAction::Status);
        set.insert(InternalHookAction::Help);
        set.insert(InternalHookAction::Connect);
        set.insert(InternalHookAction::Disconnect);
        set.insert(InternalHookAction::Message);

        assert_eq!(set.len(), 17);
        assert!(set.contains(&InternalHookAction::Start));
        assert!(set.contains(&InternalHookAction::Message));
    }

    #[test]
    fn test_internal_hook_action_eq() {
        assert_eq!(InternalHookAction::Start, InternalHookAction::Start);
        assert_ne!(InternalHookAction::Start, InternalHookAction::Stop);
        assert_ne!(InternalHookAction::Create, InternalHookAction::Resume);
    }

    #[test]
    fn test_internal_hook_action_debug() {
        assert_eq!(format!("{:?}", InternalHookAction::Start), "Start");
        assert_eq!(format!("{:?}", InternalHookAction::Bootstrap), "Bootstrap");
        assert_eq!(format!("{:?}", InternalHookAction::Create), "Create");
        assert_eq!(format!("{:?}", InternalHookAction::Connect), "Connect");
    }

    #[test]
    fn test_internal_hook_action_count() {
        // 验证所有 17 个动作都已定义
        // Agent: 4 (Start, Stop, Error, Bootstrap)
        // Session: 4 (Create, Resume, End, Compact)
        // Tool: 2 (Before, After) - Error 复用 Agent 的
        // Command: 4 (New, Reset, Status, Help)
        // Gateway: 3 (Connect, Disconnect, Message)
        // 总计: 4 + 4 + 2 + 4 + 3 = 17
        let actions = [
            InternalHookAction::Start,
            InternalHookAction::Stop,
            InternalHookAction::Error,
            InternalHookAction::Bootstrap,
            InternalHookAction::Create,
            InternalHookAction::Resume,
            InternalHookAction::End,
            InternalHookAction::Compact,
            InternalHookAction::Before,
            InternalHookAction::After,
            InternalHookAction::New,
            InternalHookAction::Reset,
            InternalHookAction::Status,
            InternalHookAction::Help,
            InternalHookAction::Connect,
            InternalHookAction::Disconnect,
            InternalHookAction::Message,
        ];
        assert_eq!(actions.len(), 17);
    }

    // ========== InternalHookEvent 测试 ==========

    #[test]
    fn test_internal_hook_event_new() {
        let event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            Some("test-session".to_string()),
            serde_json::json!({"agent_id": "agent-001"}),
        );

        assert_eq!(event.event_type, InternalHookEventType::Agent);
        assert_eq!(event.action, InternalHookAction::Start);
        assert_eq!(event.session_key, Some("test-session".to_string()));
        assert_eq!(event.context["agent_id"], "agent-001");
        assert!(event.messages.is_empty());
        // timestamp 应该是最近的时间
        let now = chrono::Utc::now();
        assert!(event.timestamp <= now);
        assert!(now.signed_duration_since(event.timestamp).num_seconds() < 1);
    }

    #[test]
    fn test_internal_hook_event_new_without_session_key() {
        let event = InternalHookEvent::new(
            InternalHookEventType::Session,
            InternalHookAction::Create,
            None,
            serde_json::json!({}),
        );

        assert_eq!(event.event_type, InternalHookEventType::Session);
        assert_eq!(event.action, InternalHookAction::Create);
        assert_eq!(event.session_key, None);
        assert_eq!(event.context, serde_json::json!({}));
        assert!(event.messages.is_empty());
    }

    #[test]
    fn test_internal_hook_event_key() {
        // Agent 事件
        let event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "agent:start");

        let event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Stop,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "agent:stop");

        let event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Error,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "agent:error");

        let event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Bootstrap,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "agent:bootstrap");

        // Session 事件
        let event = InternalHookEvent::new(
            InternalHookEventType::Session,
            InternalHookAction::Create,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "session:create");

        let event = InternalHookEvent::new(
            InternalHookEventType::Session,
            InternalHookAction::Resume,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "session:resume");

        let event = InternalHookEvent::new(
            InternalHookEventType::Session,
            InternalHookAction::End,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "session:end");

        let event = InternalHookEvent::new(
            InternalHookEventType::Session,
            InternalHookAction::Compact,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "session:compact");

        // Tool 事件
        let event = InternalHookEvent::new(
            InternalHookEventType::Tool,
            InternalHookAction::Before,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "tool:before");

        let event = InternalHookEvent::new(
            InternalHookEventType::Tool,
            InternalHookAction::After,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "tool:after");

        // Command 事件
        let event = InternalHookEvent::new(
            InternalHookEventType::Command,
            InternalHookAction::New,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "command:new");

        let event = InternalHookEvent::new(
            InternalHookEventType::Command,
            InternalHookAction::Reset,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "command:reset");

        let event = InternalHookEvent::new(
            InternalHookEventType::Command,
            InternalHookAction::Status,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "command:status");

        let event = InternalHookEvent::new(
            InternalHookEventType::Command,
            InternalHookAction::Help,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "command:help");

        // Gateway 事件
        let event = InternalHookEvent::new(
            InternalHookEventType::Gateway,
            InternalHookAction::Connect,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "gateway:connect");

        let event = InternalHookEvent::new(
            InternalHookEventType::Gateway,
            InternalHookAction::Disconnect,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "gateway:disconnect");

        let event = InternalHookEvent::new(
            InternalHookEventType::Gateway,
            InternalHookAction::Message,
            None,
            serde_json::json!({}),
        );
        assert_eq!(event.event_key(), "gateway:message");
    }

    #[test]
    fn test_internal_hook_event_key_format() {
        // 验证事件键格式为 type:action
        let event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );
        let key = event.event_key();
        assert!(key.contains(':'), "Event key should contain ':'");
        let parts: Vec<&str> = key.split(':').collect();
        assert_eq!(parts.len(), 2, "Event key should have exactly two parts");
        assert_eq!(parts[0], "agent");
        assert_eq!(parts[1], "start");
    }

    #[test]
    fn test_internal_hook_event_serialize() {
        let event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            Some("session-123".to_string()),
            serde_json::json!({"agent_id": "agent-001", "agent_type": "coding"}),
        );

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"event_type\":\"agent\""));
        assert!(json.contains("\"action\":\"start\""));
        assert!(json.contains("\"session_key\":\"session-123\""));
        assert!(json.contains("\"agent_id\":\"agent-001\""));
        assert!(json.contains("\"agent_type\":\"coding\""));
        assert!(json.contains("\"timestamp\""));
        assert!(json.contains("\"messages\":[]"));
    }

    #[test]
    fn test_internal_hook_event_deserialize() {
        let json = r#"{
            "event_type": "session",
            "action": "create",
            "session_key": "test-session",
            "context": {"session_id": "sess-001"},
            "timestamp": "2024-01-15T10:30:00Z",
            "messages": ["Hello", "World"]
        }"#;

        let event: InternalHookEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, InternalHookEventType::Session);
        assert_eq!(event.action, InternalHookAction::Create);
        assert_eq!(event.session_key, Some("test-session".to_string()));
        assert_eq!(event.context["session_id"], "sess-001");
        assert_eq!(event.messages, vec!["Hello", "World"]);
    }

    #[test]
    fn test_internal_hook_event_roundtrip() {
        let original = InternalHookEvent::new(
            InternalHookEventType::Command,
            InternalHookAction::New,
            Some("user:session:456".to_string()),
            serde_json::json!({
                "command_name": "new",
                "command_args": ["--model", "gpt-4"],
                "raw_input": "/new --model gpt-4"
            }),
        );

        let json = serde_json::to_string(&original).unwrap();
        let deserialized: InternalHookEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(original.event_type, deserialized.event_type);
        assert_eq!(original.action, deserialized.action);
        assert_eq!(original.session_key, deserialized.session_key);
        assert_eq!(original.context, deserialized.context);
        assert_eq!(original.timestamp, deserialized.timestamp);
        assert_eq!(original.messages, deserialized.messages);
    }

    #[test]
    fn test_internal_hook_event_clone() {
        let original = InternalHookEvent::new(
            InternalHookEventType::Gateway,
            InternalHookAction::Connect,
            None,
            serde_json::json!({"connection_id": "conn-001"}),
        );

        let cloned = original.clone();

        assert_eq!(original.event_type, cloned.event_type);
        assert_eq!(original.action, cloned.action);
        assert_eq!(original.session_key, cloned.session_key);
        assert_eq!(original.context, cloned.context);
        assert_eq!(original.timestamp, cloned.timestamp);
        assert_eq!(original.messages, cloned.messages);
    }

    #[test]
    fn test_internal_hook_event_debug() {
        let event = InternalHookEvent::new(
            InternalHookEventType::Tool,
            InternalHookAction::Before,
            None,
            serde_json::json!({}),
        );

        let debug_str = format!("{:?}", event);
        assert!(debug_str.contains("InternalHookEvent"));
        assert!(debug_str.contains("Tool"));
        assert!(debug_str.contains("Before"));
    }

    #[test]
    fn test_internal_hook_event_messages_mutable() {
        let mut event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );

        assert!(event.messages.is_empty());

        // 处理器可以向 messages 推送消息
        event
            .messages
            .push("Agent started successfully".to_string());
        event.messages.push("Initialization complete".to_string());

        assert_eq!(event.messages.len(), 2);
        assert_eq!(event.messages[0], "Agent started successfully");
        assert_eq!(event.messages[1], "Initialization complete");
    }

    #[test]
    fn test_internal_hook_event_context_types() {
        // 测试不同类型的 context 数据

        // Agent 事件上下文
        let agent_event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({
                "agent_id": "agent-123",
                "agent_type": "coding",
                "workspace_dir": "/path/to/workspace"
            }),
        );
        assert_eq!(agent_event.context["agent_id"], "agent-123");
        assert_eq!(agent_event.context["agent_type"], "coding");
        assert_eq!(agent_event.context["workspace_dir"], "/path/to/workspace");

        // Session 事件上下文
        let session_event = InternalHookEvent::new(
            InternalHookEventType::Session,
            InternalHookAction::End,
            Some("session-key".to_string()),
            serde_json::json!({
                "session_id": "session-456",
                "session_key": "user:session:key",
                "reason": "logout"
            }),
        );
        assert_eq!(session_event.context["session_id"], "session-456");
        assert_eq!(session_event.context["reason"], "logout");

        // Command 事件上下文
        let command_event = InternalHookEvent::new(
            InternalHookEventType::Command,
            InternalHookAction::New,
            None,
            serde_json::json!({
                "command_name": "new",
                "command_args": ["--model", "gpt-4"],
                "raw_input": "/new --model gpt-4"
            }),
        );
        assert_eq!(command_event.context["command_name"], "new");
        assert!(command_event.context["command_args"].is_array());

        // Gateway 事件上下文
        let gateway_event = InternalHookEvent::new(
            InternalHookEventType::Gateway,
            InternalHookAction::Message,
            None,
            serde_json::json!({
                "connection_id": "conn-789",
                "channel": "websocket",
                "message": "Hello, World!"
            }),
        );
        assert_eq!(gateway_event.context["connection_id"], "conn-789");
        assert_eq!(gateway_event.context["channel"], "websocket");
    }

    #[test]
    fn test_internal_hook_event_empty_context() {
        let event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Stop,
            None,
            serde_json::json!({}),
        );

        assert_eq!(event.context, serde_json::json!({}));
        assert!(event.context.as_object().unwrap().is_empty());
    }

    #[test]
    fn test_internal_hook_event_null_context() {
        let event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Stop,
            None,
            serde_json::Value::Null,
        );

        assert!(event.context.is_null());
    }

    // ========== InternalHookRegistry 测试 ==========

    #[test]
    fn test_internal_hook_registry_new() {
        let registry = InternalHookRegistry::new();
        assert!(registry.is_empty());
        assert_eq!(registry.handler_count(), 0);
        assert!(registry.get_registered_keys().is_empty());
    }

    #[test]
    fn test_internal_hook_registry_default() {
        let registry = InternalHookRegistry::default();
        assert!(registry.is_empty());
        assert_eq!(registry.handler_count(), 0);
    }

    #[test]
    fn test_internal_hook_registry_register() {
        let registry = InternalHookRegistry::new();

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        registry.register("agent:start", handler);

        assert!(!registry.is_empty());
        assert_eq!(registry.handler_count(), 1);
        assert!(registry
            .get_registered_keys()
            .contains(&"agent:start".to_string()));
    }

    #[test]
    fn test_internal_hook_registry_register_multiple_handlers_same_key() {
        let registry = InternalHookRegistry::new();

        let handler1: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        let handler2: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        let handler3: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));

        registry.register("agent:start", handler1);
        registry.register("agent:start", handler2);
        registry.register("agent:start", handler3);

        assert_eq!(registry.handler_count(), 3);
        assert_eq!(registry.get_registered_keys().len(), 1);
        assert_eq!(registry.get_handlers("agent:start").len(), 3);
    }

    #[test]
    fn test_internal_hook_registry_register_multiple_keys() {
        let registry = InternalHookRegistry::new();

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));

        registry.register("agent:start", handler.clone());
        registry.register("agent:stop", handler.clone());
        registry.register("session:create", handler);

        assert_eq!(registry.handler_count(), 3);
        assert_eq!(registry.get_registered_keys().len(), 3);
    }

    #[test]
    fn test_internal_hook_registry_register_type_level() {
        let registry = InternalHookRegistry::new();

        // 注册类型级别处理器
        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        registry.register("agent", handler);

        assert!(registry
            .get_registered_keys()
            .contains(&"agent".to_string()));
        assert_eq!(registry.get_handlers("agent").len(), 1);
    }

    #[test]
    fn test_internal_hook_registry_unregister() {
        let registry = InternalHookRegistry::new();

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        registry.register("agent:start", handler.clone());

        assert_eq!(registry.handler_count(), 1);

        let removed = registry.unregister("agent:start", &handler);
        assert!(removed);
        assert!(registry.is_empty());
        assert_eq!(registry.handler_count(), 0);
    }

    #[test]
    fn test_internal_hook_registry_unregister_not_found() {
        let registry = InternalHookRegistry::new();

        let handler1: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        let handler2: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));

        registry.register("agent:start", handler1);

        // 尝试取消注册未注册的处理器
        let removed = registry.unregister("agent:start", &handler2);
        assert!(!removed);
        assert_eq!(registry.handler_count(), 1);
    }

    #[test]
    fn test_internal_hook_registry_unregister_wrong_key() {
        let registry = InternalHookRegistry::new();

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        registry.register("agent:start", handler.clone());

        // 尝试从错误的事件键取消注册
        let removed = registry.unregister("agent:stop", &handler);
        assert!(!removed);
        assert_eq!(registry.handler_count(), 1);
    }

    #[test]
    fn test_internal_hook_registry_unregister_one_of_multiple() {
        let registry = InternalHookRegistry::new();

        let handler1: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        let handler2: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));

        registry.register("agent:start", handler1.clone());
        registry.register("agent:start", handler2);

        assert_eq!(registry.handler_count(), 2);

        let removed = registry.unregister("agent:start", &handler1);
        assert!(removed);
        assert_eq!(registry.handler_count(), 1);
        // 事件键仍然存在，因为还有一个处理器
        assert!(registry
            .get_registered_keys()
            .contains(&"agent:start".to_string()));
    }

    #[test]
    fn test_internal_hook_registry_clear() {
        let registry = InternalHookRegistry::new();

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));

        registry.register("agent:start", handler.clone());
        registry.register("agent:stop", handler.clone());
        registry.register("session:create", handler);

        assert_eq!(registry.handler_count(), 3);

        registry.clear();

        assert!(registry.is_empty());
        assert_eq!(registry.handler_count(), 0);
        assert!(registry.get_registered_keys().is_empty());
    }

    #[test]
    fn test_internal_hook_registry_get_registered_keys() {
        let registry = InternalHookRegistry::new();

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));

        registry.register("agent:start", handler.clone());
        registry.register("agent:stop", handler.clone());
        registry.register("session:create", handler.clone());
        registry.register("command:new", handler);

        let keys = registry.get_registered_keys();
        assert_eq!(keys.len(), 4);
        assert!(keys.contains(&"agent:start".to_string()));
        assert!(keys.contains(&"agent:stop".to_string()));
        assert!(keys.contains(&"session:create".to_string()));
        assert!(keys.contains(&"command:new".to_string()));
    }

    #[test]
    fn test_internal_hook_registry_get_handlers() {
        let registry = InternalHookRegistry::new();

        let handler1: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        let handler2: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));

        registry.register("agent:start", handler1);
        registry.register("agent:start", handler2);

        let handlers = registry.get_handlers("agent:start");
        assert_eq!(handlers.len(), 2);

        // 获取不存在的事件键返回空列表
        let empty_handlers = registry.get_handlers("nonexistent");
        assert!(empty_handlers.is_empty());
    }

    #[test]
    fn test_internal_hook_registry_is_empty() {
        let registry = InternalHookRegistry::new();
        assert!(registry.is_empty());

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        registry.register("agent:start", handler.clone());
        assert!(!registry.is_empty());

        registry.unregister("agent:start", &handler);
        assert!(registry.is_empty());
    }

    #[test]
    fn test_internal_hook_registry_handler_count() {
        let registry = InternalHookRegistry::new();
        assert_eq!(registry.handler_count(), 0);

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));

        registry.register("agent:start", handler.clone());
        assert_eq!(registry.handler_count(), 1);

        registry.register("agent:start", handler.clone());
        assert_eq!(registry.handler_count(), 2);

        registry.register("agent:stop", handler);
        assert_eq!(registry.handler_count(), 3);
    }

    #[test]
    fn test_internal_hook_registry_debug() {
        let registry = InternalHookRegistry::new();

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        registry.register("agent:start", handler);

        let debug_str = format!("{:?}", registry);
        assert!(debug_str.contains("InternalHookRegistry"));
        assert!(debug_str.contains("agent:start"));
    }

    #[test]
    fn test_internal_hook_registry_register_same_handler_twice() {
        let registry = InternalHookRegistry::new();

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));

        // 允许重复注册相同的处理器
        registry.register("agent:start", handler.clone());
        registry.register("agent:start", handler);

        assert_eq!(registry.handler_count(), 2);
        assert_eq!(registry.get_handlers("agent:start").len(), 2);
    }

    #[test]
    fn test_internal_hook_registry_unregister_removes_empty_key() {
        let registry = InternalHookRegistry::new();

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        registry.register("agent:start", handler.clone());

        assert!(registry
            .get_registered_keys()
            .contains(&"agent:start".to_string()));

        registry.unregister("agent:start", &handler);

        // 取消注册后，空的事件键应该被移除
        assert!(!registry
            .get_registered_keys()
            .contains(&"agent:start".to_string()));
    }

    // ========== 全局注册表单例测试 ==========

    #[test]
    fn test_global_internal_registry_returns_same_instance() {
        // 多次调用应该返回同一个实例
        let registry1 = global_internal_registry();
        let registry2 = global_internal_registry();

        // 使用指针比较确认是同一个实例
        assert!(std::ptr::eq(registry1, registry2));
    }

    #[test]
    #[serial]
    fn test_global_internal_registry_is_functional() {
        let registry = global_internal_registry();
        registry.clear();

        // 使用唯一的事件键避免与其他测试冲突
        let unique_key = format!("test:global_registry_{}", uuid::Uuid::new_v4());

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        registry.register(&unique_key, handler.clone());

        // 验证注册成功
        assert!(registry.get_registered_keys().contains(&unique_key));
        assert_eq!(registry.get_handlers(&unique_key).len(), 1);

        // 清理：取消注册
        registry.unregister(&unique_key, &handler);
    }

    #[test]
    fn test_global_internal_registry_type() {
        // 验证返回类型是 &'static InternalHookRegistry
        let registry: &'static InternalHookRegistry = global_internal_registry();

        // 验证可以调用 InternalHookRegistry 的方法
        let _ = registry.get_registered_keys();
        let _ = registry.is_empty();
        let _ = registry.handler_count();
    }

    // ========== trigger() 方法测试 ==========

    #[tokio::test]
    async fn test_trigger_no_handlers() {
        let registry = InternalHookRegistry::new();

        let mut event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );

        // 没有注册任何处理器时，应该静默返回
        let result = registry.trigger(&mut event).await;
        assert!(result.is_ok());
        assert!(event.messages.is_empty());
    }

    #[tokio::test]
    async fn test_trigger_action_level_handler() {
        let registry = InternalHookRegistry::new();

        // 使用 Arc<Mutex> 记录调用
        let called = Arc::new(std::sync::Mutex::new(false));
        let called_clone = called.clone();

        // 注意：在闭包的同步部分修改 event，然后返回一个不捕获 event 的 Future
        let handler: InternalHookHandlerFn = Arc::new(move |event| {
            *called_clone.lock().unwrap() = true;
            event.messages.push("Action handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent:start", handler);

        let mut event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );

        let result = registry.trigger(&mut event).await;
        assert!(result.is_ok());
        assert!(*called.lock().unwrap());
        assert_eq!(event.messages, vec!["Action handler called"]);
    }

    #[tokio::test]
    async fn test_trigger_type_level_handler() {
        let registry = InternalHookRegistry::new();

        let called = Arc::new(std::sync::Mutex::new(false));
        let called_clone = called.clone();

        let handler: InternalHookHandlerFn = Arc::new(move |event| {
            *called_clone.lock().unwrap() = true;
            event.messages.push("Type handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        // 注册类型级别处理器
        registry.register("agent", handler);

        let mut event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );

        let result = registry.trigger(&mut event).await;
        assert!(result.is_ok());
        assert!(*called.lock().unwrap());
        assert_eq!(event.messages, vec!["Type handler called"]);
    }

    #[tokio::test]
    async fn test_trigger_type_before_action_handlers() {
        let registry = InternalHookRegistry::new();

        // 使用 Vec 记录调用顺序
        let call_order = Arc::new(std::sync::Mutex::new(Vec::new()));

        // 类型级别处理器
        let call_order_clone = call_order.clone();
        let type_handler: InternalHookHandlerFn = Arc::new(move |event| {
            call_order_clone.lock().unwrap().push("type");
            event.messages.push("Type handler".to_string());
            Box::pin(async move { Ok(()) })
        });

        // 动作级别处理器
        let call_order_clone = call_order.clone();
        let action_handler: InternalHookHandlerFn = Arc::new(move |event| {
            call_order_clone.lock().unwrap().push("action");
            event.messages.push("Action handler".to_string());
            Box::pin(async move { Ok(()) })
        });

        // 先注册动作级别，再注册类型级别（验证调用顺序不受注册顺序影响）
        registry.register("agent:start", action_handler);
        registry.register("agent", type_handler);

        let mut event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );

        let result = registry.trigger(&mut event).await;
        assert!(result.is_ok());

        // 验证类型级别处理器先于动作级别处理器被调用
        let order = call_order.lock().unwrap();
        assert_eq!(*order, vec!["type", "action"]);
        assert_eq!(event.messages, vec!["Type handler", "Action handler"]);
    }

    #[tokio::test]
    async fn test_trigger_multiple_handlers_same_level() {
        let registry = InternalHookRegistry::new();

        let call_order = Arc::new(std::sync::Mutex::new(Vec::new()));

        // 注册多个动作级别处理器
        for i in 1..=3 {
            let call_order_clone = call_order.clone();
            let handler: InternalHookHandlerFn = Arc::new(move |event| {
                call_order_clone.lock().unwrap().push(i);
                event.messages.push(format!("Handler {}", i));
                Box::pin(async move { Ok(()) })
            });
            registry.register("agent:start", handler);
        }

        let mut event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );

        let result = registry.trigger(&mut event).await;
        assert!(result.is_ok());

        // 验证按注册顺序调用
        let order = call_order.lock().unwrap();
        assert_eq!(*order, vec![1, 2, 3]);
        assert_eq!(event.messages, vec!["Handler 1", "Handler 2", "Handler 3"]);
    }

    #[tokio::test]
    async fn test_trigger_handler_error_does_not_stop_others() {
        let registry = InternalHookRegistry::new();

        let call_order = Arc::new(std::sync::Mutex::new(Vec::new()));

        // 第一个处理器：成功
        let call_order_clone = call_order.clone();
        let handler1: InternalHookHandlerFn = Arc::new(move |event| {
            call_order_clone.lock().unwrap().push(1);
            event.messages.push("Handler 1 OK".to_string());
            Box::pin(async move { Ok(()) })
        });

        // 第二个处理器：失败
        let call_order_clone = call_order.clone();
        let handler2: InternalHookHandlerFn = Arc::new(move |_event| {
            call_order_clone.lock().unwrap().push(2);
            Box::pin(async move { Err(anyhow::anyhow!("Handler 2 failed")) })
        });

        // 第三个处理器：成功
        let call_order_clone = call_order.clone();
        let handler3: InternalHookHandlerFn = Arc::new(move |event| {
            call_order_clone.lock().unwrap().push(3);
            event.messages.push("Handler 3 OK".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent:start", handler1);
        registry.register("agent:start", handler2);
        registry.register("agent:start", handler3);

        let mut event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );

        // 即使有处理器失败，trigger 也应该返回 Ok
        let result = registry.trigger(&mut event).await;
        assert!(result.is_ok());

        // 验证所有处理器都被调用
        let order = call_order.lock().unwrap();
        assert_eq!(*order, vec![1, 2, 3]);

        // 验证成功的处理器的消息被记录
        assert_eq!(event.messages, vec!["Handler 1 OK", "Handler 3 OK"]);
    }

    #[tokio::test]
    async fn test_trigger_type_handler_error_does_not_stop_action_handlers() {
        let registry = InternalHookRegistry::new();

        let call_order: Arc<std::sync::Mutex<Vec<&str>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));

        // 类型级别处理器：失败
        let call_order_clone = call_order.clone();
        let type_handler: InternalHookHandlerFn = Arc::new(move |_event| {
            call_order_clone.lock().unwrap().push("type_error");
            Box::pin(async move { Err(anyhow::anyhow!("Type handler failed")) })
        });

        // 动作级别处理器：成功
        let call_order_clone = call_order.clone();
        let action_handler: InternalHookHandlerFn = Arc::new(move |event| {
            call_order_clone.lock().unwrap().push("action_ok");
            event.messages.push("Action handler OK".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent", type_handler);
        registry.register("agent:start", action_handler);

        let mut event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );

        let result = registry.trigger(&mut event).await;
        assert!(result.is_ok());

        // 验证类型处理器失败后，动作处理器仍然被调用
        let order = call_order.lock().unwrap();
        assert_eq!(*order, vec!["type_error", "action_ok"]);
        assert_eq!(event.messages, vec!["Action handler OK"]);
    }

    #[tokio::test]
    async fn test_trigger_different_event_types() {
        let registry = InternalHookRegistry::new();

        let agent_called = Arc::new(std::sync::Mutex::new(false));
        let session_called = Arc::new(std::sync::Mutex::new(false));

        // Agent 处理器
        let agent_called_clone = agent_called.clone();
        let agent_handler: InternalHookHandlerFn = Arc::new(move |_| {
            *agent_called_clone.lock().unwrap() = true;
            Box::pin(async move { Ok(()) })
        });

        // Session 处理器
        let session_called_clone = session_called.clone();
        let session_handler: InternalHookHandlerFn = Arc::new(move |_| {
            *session_called_clone.lock().unwrap() = true;
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent:start", agent_handler);
        registry.register("session:create", session_handler);

        // 触发 Agent 事件
        let mut agent_event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );
        registry.trigger(&mut agent_event).await.unwrap();

        // 只有 Agent 处理器被调用
        assert!(*agent_called.lock().unwrap());
        assert!(!*session_called.lock().unwrap());

        // 重置
        *agent_called.lock().unwrap() = false;

        // 触发 Session 事件
        let mut session_event = InternalHookEvent::new(
            InternalHookEventType::Session,
            InternalHookAction::Create,
            None,
            serde_json::json!({}),
        );
        registry.trigger(&mut session_event).await.unwrap();

        // 只有 Session 处理器被调用
        assert!(!*agent_called.lock().unwrap());
        assert!(*session_called.lock().unwrap());
    }

    #[tokio::test]
    async fn test_trigger_handler_can_modify_event_messages() {
        let registry = InternalHookRegistry::new();

        let handler: InternalHookHandlerFn = Arc::new(|event| {
            event.messages.push("Message 1".to_string());
            event.messages.push("Message 2".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent:start", handler);

        let mut event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({}),
        );

        registry.trigger(&mut event).await.unwrap();

        assert_eq!(event.messages.len(), 2);
        assert_eq!(event.messages[0], "Message 1");
        assert_eq!(event.messages[1], "Message 2");
    }

    #[tokio::test]
    async fn test_trigger_handler_can_read_event_context() {
        let registry = InternalHookRegistry::new();

        let captured_agent_id = Arc::new(std::sync::Mutex::new(String::new()));
        let captured_clone = captured_agent_id.clone();

        let handler: InternalHookHandlerFn = Arc::new(move |event| {
            // 在同步部分读取 context
            if let Some(agent_id) = event.context.get("agent_id").and_then(|v| v.as_str()) {
                *captured_clone.lock().unwrap() = agent_id.to_string();
            }
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent:start", handler);

        let mut event = InternalHookEvent::new(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            None,
            serde_json::json!({"agent_id": "test-agent-123"}),
        );

        registry.trigger(&mut event).await.unwrap();

        assert_eq!(*captured_agent_id.lock().unwrap(), "test-agent-123");
    }

    // ========== 辅助函数测试 ==========

    #[test]
    fn test_create_internal_hook_event() {
        let event = create_internal_hook_event(
            InternalHookEventType::Agent,
            InternalHookAction::Start,
            Some("session-123".to_string()),
            serde_json::json!({"agent_id": "agent-001"}),
        );

        assert_eq!(event.event_type, InternalHookEventType::Agent);
        assert_eq!(event.action, InternalHookAction::Start);
        assert_eq!(event.session_key, Some("session-123".to_string()));
        assert_eq!(event.context["agent_id"], "agent-001");
        assert_eq!(event.event_key(), "agent:start");
        assert!(event.messages.is_empty());
    }

    #[test]
    fn test_create_internal_hook_event_without_session_key() {
        let event = create_internal_hook_event(
            InternalHookEventType::Session,
            InternalHookAction::Create,
            None,
            serde_json::json!({}),
        );

        assert_eq!(event.event_type, InternalHookEventType::Session);
        assert_eq!(event.action, InternalHookAction::Create);
        assert_eq!(event.session_key, None);
        assert_eq!(event.event_key(), "session:create");
    }

    #[test]
    #[serial]
    fn test_register_internal_hook() {
        // 使用唯一的事件键避免与其他测试冲突
        let unique_key = format!("test:register_{}", uuid::Uuid::new_v4());

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        register_internal_hook(&unique_key, handler.clone());

        // 验证注册成功
        let registry = global_internal_registry();
        assert!(registry.get_registered_keys().contains(&unique_key));
        assert_eq!(registry.get_handlers(&unique_key).len(), 1);

        // 清理
        registry.unregister(&unique_key, &handler);
    }

    #[test]
    #[serial]
    fn test_unregister_internal_hook() {
        let unique_key = format!("test:unregister_{}", uuid::Uuid::new_v4());

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        register_internal_hook(&unique_key, handler.clone());

        // 验证注册成功
        let registry = global_internal_registry();
        assert!(registry.get_registered_keys().contains(&unique_key));

        // 取消注册
        let removed = unregister_internal_hook(&unique_key, &handler);
        assert!(removed);

        // 验证已移除
        assert!(!registry.get_registered_keys().contains(&unique_key));
    }

    #[test]
    fn test_unregister_internal_hook_not_found() {
        let unique_key = format!("test:unregister_not_found_{}", uuid::Uuid::new_v4());

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));

        // 尝试取消注册未注册的处理器
        let removed = unregister_internal_hook(&unique_key, &handler);
        assert!(!removed);
    }

    #[test]
    #[serial]
    fn test_clear_internal_hooks() {
        // 清理全局注册表以避免干扰
        let registry = global_internal_registry();
        registry.clear();

        // 注册一些处理器
        let unique_key1 = format!("test:clear1_{}", uuid::Uuid::new_v4());
        let unique_key2 = format!("test:clear2_{}", uuid::Uuid::new_v4());

        let handler: InternalHookHandlerFn = Arc::new(|_| Box::pin(async { Ok(()) }));
        register_internal_hook(&unique_key1, handler.clone());
        register_internal_hook(&unique_key2, handler.clone());

        assert!(registry.get_registered_keys().contains(&unique_key1));
        assert!(registry.get_registered_keys().contains(&unique_key2));

        // 清除所有处理器
        clear_internal_hooks();

        // 验证已清除
        assert!(!registry.get_registered_keys().contains(&unique_key1));
        assert!(!registry.get_registered_keys().contains(&unique_key2));
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_internal_hook_function() {
        // 清理全局注册表以避免干扰
        let registry = global_internal_registry();
        registry.clear();

        let unique_key = format!("test:trigger_{}", uuid::Uuid::new_v4());

        let called = Arc::new(std::sync::Mutex::new(false));
        let called_clone = called.clone();

        let handler: InternalHookHandlerFn = Arc::new(move |event| {
            *called_clone.lock().unwrap() = true;
            event.messages.push("Handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        register_internal_hook(&unique_key, handler.clone());

        // 创建一个匹配的事件（需要手动构造事件键）
        let mut event = InternalHookEvent {
            event_type: InternalHookEventType::Agent,
            action: InternalHookAction::Start,
            session_key: None,
            context: serde_json::json!({}),
            timestamp: chrono::Utc::now(),
            messages: Vec::new(),
        };

        // 由于 event_key() 返回 "agent:start"，我们需要注册到正确的键
        // 先清理之前的注册
        unregister_internal_hook(&unique_key, &handler);

        // 重新注册到正确的事件键
        register_internal_hook("agent:start", handler.clone());

        let result = trigger_internal_hook(&mut event).await;
        assert!(result.is_ok());
        assert!(*called.lock().unwrap());
        assert!(event.messages.contains(&"Handler called".to_string()));

        // 清理
        unregister_internal_hook("agent:start", &handler);
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_internal_hook_no_handlers() {
        // 清理全局注册表以避免干扰
        let registry = global_internal_registry();
        registry.clear();

        // 使用一个不太可能有处理器的事件
        let mut event = create_internal_hook_event(
            InternalHookEventType::Gateway,
            InternalHookAction::Disconnect,
            None,
            serde_json::json!({}),
        );

        // 确保没有处理器（已清理）
        let handlers = registry.get_handlers(&event.event_key());
        assert!(handlers.is_empty());

        // 没有处理器时应该静默返回
        let result = trigger_internal_hook(&mut event).await;
        assert!(result.is_ok());
        assert!(event.messages.is_empty());
    }

    // ========== Agent 事件辅助函数测试 ==========

    #[tokio::test]
    #[serial]
    async fn test_trigger_agent_start() {
        // 清理全局注册表以避免干扰
        let registry = global_internal_registry();
        registry.clear();

        // 注册一个处理器来验证事件被触发
        let called = Arc::new(std::sync::Mutex::new(false));
        let captured_context = Arc::new(std::sync::Mutex::new(serde_json::Value::Null));
        let called_clone = called.clone();
        let context_clone = captured_context.clone();

        let handler: InternalHookHandlerFn = Arc::new(move |event| {
            *called_clone.lock().unwrap() = true;
            *context_clone.lock().unwrap() = event.context.clone();
            event
                .messages
                .push("Agent start handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent:start", handler.clone());

        // 触发 agent:start 事件
        let event =
            trigger_agent_start("test-agent-001", "coding", Some("test-session".to_string()))
                .await
                .unwrap();

        // 验证事件被触发
        assert!(*called.lock().unwrap());

        // 验证事件属性
        assert_eq!(event.event_type, InternalHookEventType::Agent);
        assert_eq!(event.action, InternalHookAction::Start);
        assert_eq!(event.session_key, Some("test-session".to_string()));
        assert_eq!(event.event_key(), "agent:start");

        // 验证 context 包含 agent_id 和 agent_type
        let context = captured_context.lock().unwrap();
        assert_eq!(context["agent_id"], "test-agent-001");
        assert_eq!(context["agent_type"], "coding");

        // 验证处理器添加的消息
        assert!(event
            .messages
            .contains(&"Agent start handler called".to_string()));

        // 清理
        registry.unregister("agent:start", &handler);
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_agent_stop() {
        let registry = global_internal_registry();
        registry.clear();

        let called = Arc::new(std::sync::Mutex::new(false));
        let captured_context = Arc::new(std::sync::Mutex::new(serde_json::Value::Null));
        let called_clone = called.clone();
        let context_clone = captured_context.clone();

        let handler: InternalHookHandlerFn = Arc::new(move |event| {
            *called_clone.lock().unwrap() = true;
            *context_clone.lock().unwrap() = event.context.clone();
            event.messages.push("Agent stop handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent:stop", handler.clone());

        // 触发 agent:stop 事件
        let event = trigger_agent_stop("test-agent-002", "chat", None)
            .await
            .unwrap();

        // 验证事件被触发
        assert!(*called.lock().unwrap());

        // 验证事件属性
        assert_eq!(event.event_type, InternalHookEventType::Agent);
        assert_eq!(event.action, InternalHookAction::Stop);
        assert_eq!(event.session_key, None);
        assert_eq!(event.event_key(), "agent:stop");

        // 验证 context 包含 agent_id 和 agent_type
        let context = captured_context.lock().unwrap();
        assert_eq!(context["agent_id"], "test-agent-002");
        assert_eq!(context["agent_type"], "chat");

        // 验证处理器添加的消息
        assert!(event
            .messages
            .contains(&"Agent stop handler called".to_string()));

        // 清理
        registry.unregister("agent:stop", &handler);
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_agent_error() {
        let registry = global_internal_registry();
        registry.clear();

        let called = Arc::new(std::sync::Mutex::new(false));
        let captured_context = Arc::new(std::sync::Mutex::new(serde_json::Value::Null));
        let called_clone = called.clone();
        let context_clone = captured_context.clone();

        let handler: InternalHookHandlerFn = Arc::new(move |event| {
            *called_clone.lock().unwrap() = true;
            *context_clone.lock().unwrap() = event.context.clone();
            event
                .messages
                .push("Agent error handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent:error", handler.clone());

        // 触发 agent:error 事件
        let event = trigger_agent_error(
            "test-agent-003",
            "coding",
            "Connection timeout",
            Some("error-session".to_string()),
        )
        .await
        .unwrap();

        // 验证事件被触发
        assert!(*called.lock().unwrap());

        // 验证事件属性
        assert_eq!(event.event_type, InternalHookEventType::Agent);
        assert_eq!(event.action, InternalHookAction::Error);
        assert_eq!(event.session_key, Some("error-session".to_string()));
        assert_eq!(event.event_key(), "agent:error");

        // 验证 context 包含 agent_id、agent_type 和 error
        let context = captured_context.lock().unwrap();
        assert_eq!(context["agent_id"], "test-agent-003");
        assert_eq!(context["agent_type"], "coding");
        assert_eq!(context["error"], "Connection timeout");

        // 验证处理器添加的消息
        assert!(event
            .messages
            .contains(&"Agent error handler called".to_string()));

        // 清理
        registry.unregister("agent:error", &handler);
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_agent_bootstrap() {
        let registry = global_internal_registry();
        registry.clear();

        let called = Arc::new(std::sync::Mutex::new(false));
        let captured_context = Arc::new(std::sync::Mutex::new(serde_json::Value::Null));
        let called_clone = called.clone();
        let context_clone = captured_context.clone();

        let handler: InternalHookHandlerFn = Arc::new(move |event| {
            *called_clone.lock().unwrap() = true;
            *context_clone.lock().unwrap() = event.context.clone();
            event
                .messages
                .push("Agent bootstrap handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent:bootstrap", handler.clone());

        // 触发 agent:bootstrap 事件
        let event = trigger_agent_bootstrap(
            "test-agent-004",
            "assistant",
            Some("bootstrap-session".to_string()),
        )
        .await
        .unwrap();

        // 验证事件被触发
        assert!(*called.lock().unwrap());

        // 验证事件属性
        assert_eq!(event.event_type, InternalHookEventType::Agent);
        assert_eq!(event.action, InternalHookAction::Bootstrap);
        assert_eq!(event.session_key, Some("bootstrap-session".to_string()));
        assert_eq!(event.event_key(), "agent:bootstrap");

        // 验证 context 包含 agent_id 和 agent_type
        let context = captured_context.lock().unwrap();
        assert_eq!(context["agent_id"], "test-agent-004");
        assert_eq!(context["agent_type"], "assistant");

        // 验证处理器添加的消息
        assert!(event
            .messages
            .contains(&"Agent bootstrap handler called".to_string()));

        // 清理
        registry.unregister("agent:bootstrap", &handler);
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_agent_start_no_handlers() {
        // 清理全局注册表以避免干扰
        let registry = global_internal_registry();
        registry.clear();

        // 测试没有处理器时的行为
        let event = trigger_agent_start("no-handler-agent", "test", None)
            .await
            .unwrap();

        // 应该成功返回，messages 为空
        assert_eq!(event.event_type, InternalHookEventType::Agent);
        assert_eq!(event.action, InternalHookAction::Start);
        assert_eq!(event.context["agent_id"], "no-handler-agent");
        assert_eq!(event.context["agent_type"], "test");
        // messages 可能为空（如果没有处理器）或包含其他测试注册的处理器的消息
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_agent_events_with_type_level_handler() {
        let registry = global_internal_registry();
        registry.clear();

        // 注册类型级别处理器（匹配所有 Agent 事件）
        let call_count = Arc::new(std::sync::Mutex::new(0));
        let call_count_clone = call_count.clone();

        let handler: InternalHookHandlerFn = Arc::new(move |event| {
            *call_count_clone.lock().unwrap() += 1;
            event.messages.push("Type-level handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent", handler.clone());

        // 触发不同的 Agent 事件
        let _ = trigger_agent_start("agent-1", "coding", None)
            .await
            .unwrap();
        let _ = trigger_agent_stop("agent-1", "coding", None).await.unwrap();
        let _ = trigger_agent_error("agent-1", "coding", "error", None)
            .await
            .unwrap();
        let _ = trigger_agent_bootstrap("agent-1", "coding", None)
            .await
            .unwrap();

        // 验证类型级别处理器被调用了 4 次
        assert_eq!(*call_count.lock().unwrap(), 4);

        // 清理
        registry.unregister("agent", &handler);
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_agent_error_context_contains_error_message() {
        // 清理全局注册表以避免干扰
        let registry = global_internal_registry();
        registry.clear();

        // 验证 agent:error 事件的 context 包含错误信息
        let event = trigger_agent_error(
            "error-agent",
            "coding",
            "This is a detailed error message with special chars: <>&\"'",
            None,
        )
        .await
        .unwrap();

        assert_eq!(
            event.context["error"],
            "This is a detailed error message with special chars: <>&\"'"
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_agent_events_return_event_with_messages() {
        let registry = global_internal_registry();
        registry.clear();

        // 注册处理器添加多条消息
        let handler: InternalHookHandlerFn = Arc::new(|event| {
            event.messages.push("Message 1".to_string());
            event.messages.push("Message 2".to_string());
            event.messages.push("Message 3".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("agent:start", handler.clone());

        let event = trigger_agent_start("msg-agent", "coding", None)
            .await
            .unwrap();

        // 验证返回的事件包含处理器添加的消息
        assert!(event.messages.contains(&"Message 1".to_string()));
        assert!(event.messages.contains(&"Message 2".to_string()));
        assert!(event.messages.contains(&"Message 3".to_string()));

        // 清理
        registry.unregister("agent:start", &handler);
    }

    // ========== Session 事件触发函数测试 ==========

    #[tokio::test]
    #[serial]
    async fn test_trigger_session_create() {
        let registry = global_internal_registry();
        registry.clear();

        // 注册处理器
        let handler: InternalHookHandlerFn = Arc::new(|event| {
            event
                .messages
                .push("session:create handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("session:create", handler.clone());

        // 触发 session:create 事件
        let event = trigger_session_create("test-session-001", "user:session:123")
            .await
            .unwrap();

        // 验证事件属性
        assert_eq!(event.event_type, InternalHookEventType::Session);
        assert_eq!(event.action, InternalHookAction::Create);
        assert_eq!(event.event_key(), "session:create");
        assert_eq!(event.session_key, Some("user:session:123".to_string()));

        // 验证 context 包含 session_id 和 session_key
        assert_eq!(event.context["session_id"], "test-session-001");
        assert_eq!(event.context["session_key"], "user:session:123");

        // 验证处理器被调用
        assert!(event
            .messages
            .contains(&"session:create handler called".to_string()));

        // 清理
        registry.unregister("session:create", &handler);
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_session_resume() {
        let registry = global_internal_registry();
        registry.clear();

        // 注册处理器
        let handler: InternalHookHandlerFn = Arc::new(|event| {
            event
                .messages
                .push("session:resume handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("session:resume", handler.clone());

        // 触发 session:resume 事件
        let event = trigger_session_resume("test-session-002", "user:session:456")
            .await
            .unwrap();

        // 验证事件属性
        assert_eq!(event.event_type, InternalHookEventType::Session);
        assert_eq!(event.action, InternalHookAction::Resume);
        assert_eq!(event.event_key(), "session:resume");
        assert_eq!(event.session_key, Some("user:session:456".to_string()));

        // 验证 context 包含 session_id 和 session_key
        assert_eq!(event.context["session_id"], "test-session-002");
        assert_eq!(event.context["session_key"], "user:session:456");

        // 验证处理器被调用
        assert!(event
            .messages
            .contains(&"session:resume handler called".to_string()));

        // 清理
        registry.unregister("session:resume", &handler);
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_session_end() {
        let registry = global_internal_registry();
        registry.clear();

        // 注册处理器
        let handler: InternalHookHandlerFn = Arc::new(|event| {
            event
                .messages
                .push("session:end handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("session:end", handler.clone());

        // 触发 session:end 事件（带 reason）
        let event = trigger_session_end("test-session-003", "user:session:789", Some("logout"))
            .await
            .unwrap();

        // 验证事件属性
        assert_eq!(event.event_type, InternalHookEventType::Session);
        assert_eq!(event.action, InternalHookAction::End);
        assert_eq!(event.event_key(), "session:end");
        assert_eq!(event.session_key, Some("user:session:789".to_string()));

        // 验证 context 包含 session_id、session_key 和 reason
        assert_eq!(event.context["session_id"], "test-session-003");
        assert_eq!(event.context["session_key"], "user:session:789");
        assert_eq!(event.context["reason"], "logout");

        // 验证处理器被调用
        assert!(event
            .messages
            .contains(&"session:end handler called".to_string()));

        // 清理
        registry.unregister("session:end", &handler);
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_session_end_without_reason() {
        // 清理全局注册表以避免干扰
        let registry = global_internal_registry();
        registry.clear();

        // 触发 session:end 事件（不带 reason）
        let event = trigger_session_end("test-session-004", "user:session:abc", None)
            .await
            .unwrap();

        // 验证 reason 默认为 "other"
        assert_eq!(event.context["reason"], "other");
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_session_compact() {
        let registry = global_internal_registry();
        registry.clear();

        // 注册处理器
        let handler: InternalHookHandlerFn = Arc::new(|event| {
            event
                .messages
                .push("session:compact handler called".to_string());
            Box::pin(async move { Ok(()) })
        });

        registry.register("session:compact", handler.clone());

        // 触发 session:compact 事件
        let event = trigger_session_compact("test-session-005", "user:session:xyz")
            .await
            .unwrap();

        // 验证事件属性
        assert_eq!(event.event_type, InternalHookEventType::Session);
        assert_eq!(event.action, InternalHookAction::Compact);
        assert_eq!(event.event_key(), "session:compact");
        assert_eq!(event.session_key, Some("user:session:xyz".to_string()));

        // 验证 context 包含 session_id 和 session_key
        assert_eq!(event.context["session_id"], "test-session-005");
        assert_eq!(event.context["session_key"], "user:session:xyz");

        // 验证处理器被调用
        assert!(event
            .messages
            .contains(&"session:compact handler called".to_string()));

        // 清理
        registry.unregister("session:compact", &handler);
    }

    #[tokio::test]
    #[serial]
    async fn test_trigger_session_events_with_type_level_handler() {
        let registry = global_internal_registry();
        registry.clear();

        // 注册类型级别处理器（匹配所有 Session 事件）
        let call_count = Arc::new(std::sync::Mutex::new(0));
        let call_count_clone = call_count.clone();

        let handler: InternalHookHandlerFn = Arc::new(move |event| {
            // 只计数我们自己的处理器调用
            event.messages.push("type_level_handler_called".to_string());
            *call_count_clone.lock().unwrap() += 1;
            Box::pin(async move { Ok(()) })
        });

        registry.register("session", handler.clone());

        // 触发所有 Session 事件
        let e1 = trigger_session_create("s1", "key1").await.unwrap();
        let e2 = trigger_session_resume("s2", "key2").await.unwrap();
        let e3 = trigger_session_end("s3", "key3", None).await.unwrap();
        let e4 = trigger_session_compact("s4", "key4").await.unwrap();

        // 验证每个事件都收到了类型级别处理器的消息
        assert!(e1
            .messages
            .contains(&"type_level_handler_called".to_string()));
        assert!(e2
            .messages
            .contains(&"type_level_handler_called".to_string()));
        assert!(e3
            .messages
            .contains(&"type_level_handler_called".to_string()));
        assert!(e4
            .messages
            .contains(&"type_level_handler_called".to_string()));

        // 验证类型级别处理器至少被调用了 4 次
        assert!(*call_count.lock().unwrap() >= 4);

        // 清理
        registry.unregister("session", &handler);
    }
}
