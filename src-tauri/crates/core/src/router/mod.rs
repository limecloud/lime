//! 路由系统模块
//!
//! 支持当前主链路由规则、Amp CLI 路由与模型映射。
//!
//! 路由格式：
//! - `/v1/messages` - 默认路由
//! - `/v1/chat/completions` - 默认 OpenAI 协议路由
//! - `/api/provider/{provider}/v1/*` - Amp CLI 路由
//!
//! 模型映射：
//! - 支持模型别名映射（如 `gpt-4` -> `claude-sonnet-4-5-20250514`）
//!
//! 提示路由：
//! - 支持消息前缀提示路由（如 `[reasoning] 请分析...`）

mod amp_router;
mod hint_router;
mod mapper;
mod rules;

pub use amp_router::AmpRouter;
pub use hint_router::{HintMatch, HintRoute, HintRouteEntry, HintRouter, HintRouterConfig};
pub use mapper::ModelMapper;
pub use rules::Router;
