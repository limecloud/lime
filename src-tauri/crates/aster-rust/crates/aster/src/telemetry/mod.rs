//! 遥测系统
//!
//! 跟踪使用统计和事件（本地存储，支持批量上报）

mod config;
mod sanitizer;
mod tracker;
mod types;

pub use config::*;
pub use sanitizer::*;
pub use tracker::*;
pub use types::*;

#[cfg(test)]
mod tests;
