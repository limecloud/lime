//! Rewind 功能模块
//!
//! 提供对话和文件状态的回退功能，支持：
//! - 文件历史追踪和快照
//! - 对话状态回退
//! - 全局实例管理
//! - 完整的单元测试覆盖

mod file_history;
mod manager;

pub use file_history::{FileBackup, FileHistoryManager, FileSnapshot, RewindResult};
pub use manager::{
    cleanup_all_rewind_managers,
    cleanup_rewind_manager,
    // 全局实例管理
    get_rewind_manager,
    ConversationRewindResult,
    RewindManager,
    RewindOperationResult,
    RewindOption,
    RewindPreview,
    RewindableMessage,
    SnapshotDetails,
};
