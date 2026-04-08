//! 统一记忆系统模块
//!
//! - 类型定义 (types)
//! - 对话记忆 (chat_memory)
//! - 记忆压缩 (compressor)
//! - 简单记忆管理 (memory_manager)

pub mod chat_memory;
pub mod compressor;
pub mod memory_manager;
pub mod types;

#[cfg(test)]
mod tests;

// Re-exports
pub use chat_memory::ChatMemory;
pub use compressor::{CompressionResult, CompressorConfig, MemoryCompressor, Period};
pub use memory_manager::MemoryManager;
pub use types::{
    ChatMemoryStats, ChatMemoryStore, ChunkMessage, CommunicationStyle, ConversationChunk,
    ConversationSummary, IdentityMemoryStore, LinkMemoryStore, MemoryEmotion, MemoryEntry,
    MemoryEvent, MemoryEventType, MemoryHierarchyConfig, MemoryImportance, MemoryLink,
    MemoryRecallResult, MemoryScope, MemoryStats, MessageRole, SelfAwareness, SimpleMemoryStore,
    SymbolInfo, SymbolType, Timestamp, UserProfile,
};
