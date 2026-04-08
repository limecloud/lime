//! Session 模块
//!
//! 提供 session 管理功能，包括：
//! - `SessionStore` trait: 可插拔的存储抽象
//! - `SessionManager`: 向后兼容的静态方法（使用全局 store）
//! - SQLite 默认实现
//!
//! ## 使用方式
//!
//! ### 方式 1: 使用默认 SQLite 存储（向后兼容）
//! ```ignore
//! use aster::session::SessionManager;
//! let session = SessionManager::create_session(dir, name, session_type).await?;
//! ```
//!
//! ### 方式 2: 注入自定义存储（推荐）
//! ```ignore
//! use aster::session::{SessionStore, NoopSessionStore};
//! use aster::agents::Agent;
//!
//! let store = Arc::new(MyCustomStore::new());
//! let agent = Agent::new().with_session_store(store);
//! ```

mod archive;
mod bootstrap;
mod chat_history_search;
mod cleanup;
mod diagnostics;
mod export;
pub mod extension_data;
mod fork;
mod legacy;
mod memory;
mod memory_deduplicator;
mod memory_extractor;
mod memory_pipeline;
mod memory_repository;
mod memory_retriever;
pub mod resume;
mod runtime_queue;
mod runtime_store;
pub mod session_manager;
mod statistics;
mod store;
mod subagent;
mod team;
mod worktree;

// 导出存储抽象
pub use bootstrap::{
    initialize_shared_session_runtime_with_root, load_shared_session_runtime_snapshot,
    require_shared_session_runtime_store,
};
pub use store::{
    get_global_session_store, is_global_session_store_set, set_global_session_store,
    ChatHistoryMatch, NoopSessionStore, SessionStore, TokenStatsUpdate,
};

// 导出现有功能（向后兼容）
pub use archive::{
    archive_and_delete_session, archive_session, bulk_archive_sessions, delete_archived_session,
    list_archived_sessions, restore_archived_session, BulkArchiveResult,
};
pub use cleanup::{
    cleanup_expired_data, force_cleanup, get_cutoff_date, schedule_cleanup, CleanupStats,
    DEFAULT_CLEANUP_PERIOD_DAYS,
};
pub use diagnostics::generate_diagnostics;
pub use export::{
    bulk_export_sessions, export_session, export_session_to_file, ExportFormat, ExportOptions,
};
pub use extension_data::{
    resolve_task_board_state, EnabledExtensionsState, ExtensionData, ExtensionState, TaskBoardItem,
    TaskBoardItemStatus, TaskBoardState,
};
pub use fork::{
    fork_session, get_session_branch_tree, merge_sessions, ForkMetadata, ForkOptions, MergeOptions,
    MergeStrategy, MetadataStrategy, SessionBranchTree,
};
pub use memory::{
    CommitOptions, CommitReport, MemoryCategory, MemoryHealth, MemoryRecord, MemorySearchResult,
    MemoryStats,
};
pub use resume::{
    build_resume_message, delete_summary, has_summary, list_summaries, load_summary,
    load_summary_data, save_summary, SummaryCacheData,
};
pub use runtime_queue::{
    require_shared_session_runtime_queue_service, RuntimeQueueSubmitResult,
    SessionRuntimeQueueService,
};
pub use runtime_store::{
    delete_shared_thread_runtime_session, initialize_default_shared_sqlite_thread_runtime_store,
    initialize_shared_sqlite_thread_runtime_store, initialize_shared_thread_runtime_store,
    load_session_runtime_snapshot, require_shared_thread_runtime_store, InMemoryThreadRuntimeStore,
    ItemRuntime, ItemRuntimePayload, ItemStatus, NoopThreadRuntimeStore, QueuedTurnRuntime,
    SessionExecutionGate, SessionRuntimeSnapshot, SqliteThreadRuntimeStore, ThreadRuntime,
    ThreadRuntimeSnapshot, ThreadRuntimeStore, ThreadStatus, TurnContextOverride,
    TurnOutputSchemaRuntime, TurnOutputSchemaSource, TurnOutputSchemaStrategy, TurnRuntime,
    TurnStatus, RUNTIME_DB_NAME,
};
pub use session_manager::{Session, SessionInsights, SessionManager, SessionType};
pub use statistics::{
    calculate_statistics, generate_report, get_all_statistics, SessionStatistics, SessionSummary,
};
pub use subagent::{
    list_subagent_child_sessions, list_subagent_sessions_with_metadata,
    resolve_named_subagent_child_session, resolve_subagent_session_metadata,
    SubagentSessionMetadata, SUBAGENT_SESSION_ORIGIN_TOOL,
};
pub use team::{
    resolve_team_context, resolve_team_task_list_id, save_team_membership, save_team_state,
    ResolvedTeamContext, TeamMember, TeamMembershipState, TeamSessionState, TEAM_LEAD_NAME,
};
pub use worktree::WorktreeSessionState;
