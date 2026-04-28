//! 协议转换层
//!
//! 处理 current Provider 所需的请求和响应格式转换。
//!
//! # 架构设计
//!
//! ```text
//! translator/
//! └── traits.rs              # 转换器 trait 定义
//! ```

pub mod traits;

// 重新导出核心类型
pub use traits::{
    RequestTranslator, ResponseTranslator, SseResponseTranslator, TranslateError,
    TranslateErrorKind,
};
