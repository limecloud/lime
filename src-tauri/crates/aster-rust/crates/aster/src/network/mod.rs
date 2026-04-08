//! 网络模块
//!
//! 提供代理、超时、重试等网络功能

mod capability_routing_metrics;
mod proxy;
mod request_dedup;
mod response_cache;
mod retry;
mod timeout;

pub use capability_routing_metrics::*;
pub use proxy::*;
pub use request_dedup::*;
pub use response_cache::*;
pub use retry::*;
pub use timeout::*;

#[cfg(test)]
mod tests;
