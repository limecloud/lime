pub mod agent_runtime_queue_repository;
pub mod agent_session_repository;
pub mod dao;
pub mod migration;
mod migration_support;
pub mod migration_v2;
pub mod migration_v3;
pub mod migration_v4;
pub mod migration_v5;
pub mod migration_v6;
pub mod schema;
mod startup_migrations;
pub mod system_providers;

use crate::app_paths;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// 进程内共享的 SQLite 连接。
///
/// 注意：
/// - `DbConnection` 底层是单个 `Mutex<Connection>`，不支持同调用链重入获取锁。
/// - 持有 `lock_db()` / `db.lock()` 返回的 guard 时，不要再调用会再次依赖
///   `DbConnection` 的 manager / service / wrapper。
/// - 如果调用方已经拿到了 `&Connection`，优先沿用该连接向下传递。
pub type DbConnection = Arc<Mutex<Connection>>;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ConversationWindowSummary {
    pub session_count: i64,
    pub message_count: i64,
    pub content_chars: i64,
}

/// 获取数据库连接锁（自动处理 poisoned lock）
pub fn lock_db(db: &DbConnection) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    match db.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => {
            tracing::warn!("[数据库] 检测到数据库锁被污染，尝试恢复: {}", poisoned);
            db.clear_poison();
            Ok(poisoned.into_inner())
        }
    }
}

/// 获取数据库文件路径
pub fn get_db_path() -> Result<PathBuf, String> {
    app_paths::resolve_database_path()
}

/// 初始化数据库连接
pub fn init_database() -> Result<DbConnection, String> {
    let db_path = get_db_path()?;
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // 设置 busy_timeout 为 5 秒，避免 "database is locked" 错误
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("设置 busy_timeout 失败: {e}"))?;

    // 启用 WAL 模式提升并发性能
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -64000;
         PRAGMA temp_store = MEMORY;",
    )
    .map_err(|e| format!("设置数据库优化参数失败: {e}"))?;

    tracing::info!("[数据库] 已启用 WAL 模式和性能优化参数");

    // 创建表结构
    schema::create_tables(&conn).map_err(|e| e.to_string())?;
    migration::migrate_from_json(&conn)?;
    startup_migrations::run_startup_migrations(&conn);

    Ok(Arc::new(Mutex::new(conn)))
}
