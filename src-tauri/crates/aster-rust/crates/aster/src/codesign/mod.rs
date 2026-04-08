//! 代码签名系统
//!
//! 用于签名和验证代码的安全模块
//!
//! # 功能
//! - 生成签名密钥对 (Ed25519)
//! - 对文件内容进行哈希和签名
//! - 验证文件签名
//! - 签名缓存和持久化

mod keys;
mod signing;
mod storage;
mod types;

pub use keys::*;
pub use signing::*;
pub use storage::*;
pub use types::*;
