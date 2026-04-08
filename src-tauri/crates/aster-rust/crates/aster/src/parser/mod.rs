//! Code Parser Module
//!
//! 基于 LSP (Language Server Protocol) 的代码解析模块。
//!
//! 功能:
//! - LSP 客户端管理
//! - 符号提取 (函数、类、方法等)
//! - 引用查找
//! - 跳转到定义
//! - 代码折叠区域检测

pub mod lsp_client;
pub mod lsp_manager;
pub mod symbol_extractor;
pub mod types;

pub use lsp_client::{LspClient, LspClientConfig, LspServerState};
pub use lsp_manager::{LspManager, LspServerInfo, LSP_SERVERS};
pub use symbol_extractor::{CodeSymbol, LspSymbolExtractor, Reference, SymbolKind};
pub use types::*;
