//! Lime Providers Crate
//!
//! 包含所有 Provider 实现、协议转换、流式传输等核心业务模块。
//!
//! ## 模块结构
//! - `providers`: Provider 实现（API Key Provider 所需的 Gemini、Claude、OpenAI、Vertex 等）
//! - `converter`: 协议转换（OpenAI ↔ Antigravity 等）
//! - `streaming`: 流式传输管理
//! - `translator`: 请求/响应翻译层
//! - `stream`: 流事件解析和生成
//! - `session`: 会话管理（签名存储、会话 ID 生成）

pub mod converter;
pub mod providers;
pub mod session;
pub mod stream;
pub mod streaming;
pub mod translator;
