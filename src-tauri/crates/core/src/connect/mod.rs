//! Lime Connect 模块
//!
//! 实现中转商生态合作方案，通过 Deep Link 协议实现一键配置功能。
//!
//! ## 子模块
//!
//! - `deep_link` - Deep Link URL 解析
//! - `registry` - 中转商注册表管理
//! - `webhook` - 统计回调服务
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! use lime::connect::{parse_deep_link, RelayRegistry};
//!
//! // 解析 Deep Link
//! let payload = parse_deep_link("lime://connect?relay=example&key=sk-xxx")?;
//!
//! // 查询中转商信息
//! let registry = RelayRegistry::new(cache_path);
//! let relay_info = registry.get(&payload.relay);
//!
//! // API Key 通过 API Key Provider 主路径保存
//! ```

// 子模块声明
pub mod deep_link;
pub mod registry;
pub mod webhook;

// 重新导出核心类型
pub use deep_link::{
    parse_deep_link, parse_open_deep_link, ConnectPayload, DeepLinkError, LimeDeepLinkPayload,
    OpenDeepLinkKind, OpenDeepLinkPayload,
};
pub use registry::{
    RegistryData, RegistryError, RelayApi, RelayBranding, RelayContact, RelayFeatures, RelayInfo,
    RelayLinks, RelayRegistry, RelayWebhook,
};
pub use webhook::{
    send_cancelled_callback, send_error_callback, send_success_callback, CallbackPayload,
    CallbackStatus, WebhookError, WebhookSender,
};
