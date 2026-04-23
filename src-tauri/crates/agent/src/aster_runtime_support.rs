//! Aster runtime 支持模块
//!
//! 收口 Lime 对 Aster thread runtime store 的访问边界，
//! 避免业务层散落依赖上游 free function。

use crate::aster_state::QueuedTurnTask;
use crate::queued_turn::QueuedTurnSnapshot;
use aster::session::{
    initialize_shared_session_runtime_with_root, load_shared_session_runtime_snapshot,
    require_shared_session_runtime_store, QueuedTurnRuntime, SessionRuntimeSnapshot,
    ThreadRuntimeStore,
};
use lime_core::app_paths;
use lime_core::database::agent_runtime_queue_repository::{self, LegacyRuntimeQueuedTurn};
use lime_core::database::{lock_db, DbConnection};
use lime_services::aster_session_store::LimeSessionStore;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

const QUEUED_TURN_EVENT_NAME_METADATA_KEY: &str = "event_name";
const DEFAULT_QUEUE_EVENT_NAME: &str = "agent_stream";
static ASTER_RUNTIME_ROOT: OnceLock<Result<PathBuf, String>> = OnceLock::new();

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct LegacyRuntimeQueueMigrationReport {
    pub session_count: usize,
    pub migrated_turn_count: usize,
    pub skipped_existing_turn_count: usize,
    pub invalid_turn_count: usize,
}

pub(crate) fn ensure_aster_runtime_dirs() -> Result<PathBuf, String> {
    ASTER_RUNTIME_ROOT
        .get_or_init(initialize_aster_runtime_dirs)
        .clone()
}

pub(crate) fn require_aster_runtime_dirs() -> Result<PathBuf, String> {
    match ASTER_RUNTIME_ROOT.get() {
        Some(result) => result.clone(),
        None => Err(
            "Aster 运行时尚未初始化；应在应用启动期先调用 ensure_aster_runtime_dirs()".to_string(),
        ),
    }
}

#[cfg(test)]
pub(crate) fn ensure_aster_runtime_dirs_with_root(root: PathBuf) -> Result<PathBuf, String> {
    ASTER_RUNTIME_ROOT
        .get_or_init(|| initialize_aster_runtime_dirs_with_root(root))
        .clone()
}

/// 启动期显式初始化 Aster runtime 目录、共享 runtime store 与全局 session store。
pub fn initialize_aster_runtime(db: DbConnection) -> Result<(), String> {
    let runtime_root = ensure_aster_runtime_dirs()?;
    let session_store = Arc::new(LimeSessionStore::new(db.clone()));
    let migration_db = db.clone();

    block_on_aster_runtime_init(async move {
        initialize_shared_session_runtime_with_root(runtime_root, Some(session_store))
            .await
            .map_err(|error| format!("初始化 Aster runtime 失败: {error}"))?;
        migrate_legacy_runtime_queue_to_aster_store(&migration_db).await?;
        Ok(())
    })
}

fn block_on_aster_runtime_init<F>(future: F) -> Result<(), String>
where
    F: Future<Output = Result<(), String>>,
{
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        return handle.block_on(future);
    }

    #[cfg(target_os = "windows")]
    tracing::info!("[AsterRuntime] Windows 平台 - 创建 Tokio Runtime (IOCP)");

    #[cfg(target_os = "macos")]
    tracing::info!("[AsterRuntime] macOS 平台 - 创建 Tokio Runtime (kqueue)");

    #[cfg(target_os = "linux")]
    tracing::info!("[AsterRuntime] Linux 平台 - 创建 Tokio Runtime (epoll)");

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("lime-runtime")
        .enable_io()
        .enable_time()
        .build()
        .map_err(|error| format!("创建 Tokio Runtime 失败: {error}"))?;
    runtime.block_on(future)
}

fn initialize_aster_runtime_dirs() -> Result<PathBuf, String> {
    if let Some(existing_root) = aster::config::paths::initialized_path_root() {
        return initialize_aster_runtime_dirs_with_root(existing_root);
    }

    initialize_aster_runtime_dirs_with_root(app_paths::resolve_aster_dir()?)
}

fn initialize_aster_runtime_dirs_with_root(root: PathBuf) -> Result<PathBuf, String> {
    let runtime_root = root.clone();
    block_on_aster_runtime_init(async move {
        initialize_shared_session_runtime_with_root(runtime_root, None)
            .await
            .map_err(|error| format!("初始化 Aster runtime 失败: {error}"))
    })?;
    Ok(root)
}

/// 获取 Lime 当前统一使用的 Aster runtime store。
pub(crate) fn require_aster_runtime_store() -> Result<Arc<dyn ThreadRuntimeStore>, String> {
    ensure_aster_runtime_dirs()?;
    require_shared_session_runtime_store().map_err(|error| error.to_string())
}

async fn ensure_aster_runtime_dirs_async() -> Result<PathBuf, String> {
    if ASTER_RUNTIME_ROOT.get().is_some() {
        return require_aster_runtime_dirs();
    }

    tokio::task::spawn_blocking(ensure_aster_runtime_dirs)
        .await
        .map_err(|error| format!("异步初始化 Aster runtime 失败: {error}"))?
}

async fn require_aster_runtime_store_async() -> Result<Arc<dyn ThreadRuntimeStore>, String> {
    ensure_aster_runtime_dirs_async().await?;
    require_shared_session_runtime_store().map_err(|error| error.to_string())
}

/// 读取会话 runtime snapshot。
pub(crate) async fn load_aster_runtime_snapshot(
    session_id: &str,
) -> Result<SessionRuntimeSnapshot, String> {
    ensure_aster_runtime_dirs_async().await?;
    load_shared_session_runtime_snapshot(session_id)
        .await
        .map_err(|error| format!("读取 runtime snapshot 失败: {error}"))
}

pub(crate) async fn list_aster_runtime_queued_turns(
    session_id: &str,
) -> Result<Vec<QueuedTurnRuntime>, String> {
    let store = require_aster_runtime_store_async().await?;
    store
        .list_queued_turns(session_id)
        .await
        .map_err(|error| format!("读取 queued runtime turns 失败: {error}"))
}

async fn list_aster_runtime_queued_turn_session_ids() -> Result<Vec<String>, String> {
    let store = require_aster_runtime_store_async().await?;
    store
        .list_queued_turn_session_ids()
        .await
        .map_err(|error| format!("读取 queued runtime session ids 失败: {error}"))
}

/// 启动恢复统一入口：只在这里完成当前 queued session 枚举。
pub(crate) async fn prepare_aster_runtime_queue_resumption() -> Result<Vec<String>, String> {
    ensure_aster_runtime_dirs_async().await?;
    list_aster_runtime_queued_turn_session_ids().await
}

/// 将暂存的 queued turns 恢复回统一 Aster runtime queue 边界。
pub async fn restore_aster_runtime_queued_turns(
    queued_turns: Vec<QueuedTurnRuntime>,
) -> Result<(), String> {
    for queued_turn in queued_turns {
        enqueue_aster_runtime_turn(queued_turn).await?;
    }
    Ok(())
}

pub(crate) async fn enqueue_aster_runtime_turn(
    queued_turn: QueuedTurnRuntime,
) -> Result<QueuedTurnRuntime, String> {
    let store = require_aster_runtime_store_async().await?;
    store
        .enqueue_turn(queued_turn)
        .await
        .map_err(|error| format!("写入 queued runtime turn 失败: {error}"))
}

pub(crate) async fn remove_aster_runtime_queued_turn(
    queued_turn_id: &str,
) -> Result<Option<QueuedTurnRuntime>, String> {
    let store = require_aster_runtime_store_async().await?;
    store
        .remove_queued_turn(queued_turn_id)
        .await
        .map_err(|error| format!("删除 queued runtime turn 失败: {error}"))
}

pub(crate) async fn clear_aster_runtime_queued_turns(
    session_id: &str,
) -> Result<Vec<QueuedTurnRuntime>, String> {
    let store = require_aster_runtime_store_async().await?;
    store
        .clear_queued_turns(session_id)
        .await
        .map_err(|error| format!("清空 queued runtime turns 失败: {error}"))
}

pub(crate) fn queued_turn_runtime_from_task(task: &QueuedTurnTask<Value>) -> QueuedTurnRuntime {
    build_queued_turn_runtime(QueuedTurnRuntimeInput {
        queued_turn_id: &task.queued_turn_id,
        session_id: &task.session_id,
        event_name: &task.event_name,
        message_preview: &task.message_preview,
        message_text: &task.message_text,
        created_at: task.created_at,
        image_count: task.image_count,
        payload: task.payload.clone(),
    })
}

pub(crate) fn queued_turn_event_name_from_runtime(queued_turn: &QueuedTurnRuntime) -> String {
    queued_turn
        .metadata
        .get(QUEUED_TURN_EVENT_NAME_METADATA_KEY)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_QUEUE_EVENT_NAME)
        .to_string()
}

pub(crate) fn queued_turn_snapshot_from_runtime(
    queued_turn: &QueuedTurnRuntime,
    position: usize,
) -> QueuedTurnSnapshot {
    QueuedTurnSnapshot {
        queued_turn_id: queued_turn.queued_turn_id.clone(),
        message_preview: queued_turn.message_preview.clone(),
        message_text: queued_turn.message_text.clone(),
        created_at: queued_turn.created_at,
        image_count: queued_turn.image_count,
        position,
    }
}

async fn migrate_legacy_runtime_queue_to_aster_store(
    db: &DbConnection,
) -> Result<LegacyRuntimeQueueMigrationReport, String> {
    ensure_aster_runtime_dirs_async().await?;
    let snapshot = {
        let conn = lock_db(db)?;
        agent_runtime_queue_repository::load_legacy_runtime_queue_snapshot(&conn)?
    };
    let Some(snapshot) = snapshot else {
        return Ok(LegacyRuntimeQueueMigrationReport::default());
    };

    let mut report = LegacyRuntimeQueueMigrationReport {
        session_count: snapshot.sessions.len(),
        invalid_turn_count: snapshot.invalid_turn_count,
        ..LegacyRuntimeQueueMigrationReport::default()
    };

    for session in snapshot.sessions {
        let mut existing_ids = list_aster_runtime_queued_turns(&session.session_id)
            .await?
            .into_iter()
            .map(|queued_turn| queued_turn.queued_turn_id)
            .collect::<HashSet<_>>();

        for queued_turn in session.turns {
            if !existing_ids.insert(queued_turn.queued_turn_id.clone()) {
                report.skipped_existing_turn_count += 1;
                continue;
            }

            enqueue_aster_runtime_turn(queued_turn_runtime_from_legacy_turn(&queued_turn)).await?;
            report.migrated_turn_count += 1;
        }
    }

    {
        let conn = lock_db(db)?;
        agent_runtime_queue_repository::drop_legacy_runtime_queue_table(&conn)?;
    }
    tracing::info!(
        "[AsterAgent][Queue] legacy 排队队列已导入到 Aster store: sessions={}, migrated={}, skipped_existing={}, invalid={}",
        report.session_count,
        report.migrated_turn_count,
        report.skipped_existing_turn_count,
        report.invalid_turn_count
    );
    Ok(report)
}

fn queued_turn_runtime_from_legacy_turn(
    queued_turn: &LegacyRuntimeQueuedTurn,
) -> QueuedTurnRuntime {
    build_queued_turn_runtime(QueuedTurnRuntimeInput {
        queued_turn_id: &queued_turn.queued_turn_id,
        session_id: &queued_turn.session_id,
        event_name: &queued_turn.event_name,
        message_preview: &queued_turn.message_preview,
        message_text: &queued_turn.message_text,
        created_at: queued_turn.created_at,
        image_count: queued_turn.image_count,
        payload: queued_turn.payload.clone(),
    })
}

struct QueuedTurnRuntimeInput<'a> {
    queued_turn_id: &'a str,
    session_id: &'a str,
    event_name: &'a str,
    message_preview: &'a str,
    message_text: &'a str,
    created_at: i64,
    image_count: usize,
    payload: Value,
}

fn build_queued_turn_runtime(input: QueuedTurnRuntimeInput<'_>) -> QueuedTurnRuntime {
    let QueuedTurnRuntimeInput {
        queued_turn_id,
        session_id,
        event_name,
        message_preview,
        message_text,
        created_at,
        image_count,
        payload,
    } = input;
    let mut metadata = HashMap::new();
    if !event_name.trim().is_empty() {
        metadata.insert(
            QUEUED_TURN_EVENT_NAME_METADATA_KEY.to_string(),
            Value::String(event_name.to_string()),
        );
    }

    QueuedTurnRuntime {
        queued_turn_id: queued_turn_id.to_string(),
        session_id: session_id.to_string(),
        message_preview: message_preview.to_string(),
        message_text: message_text.to_string(),
        created_at,
        image_count,
        payload,
        metadata,
    }
}
