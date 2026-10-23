//! 单本地host的持久清理请求；不持久化工作树清单或线程副本。

use super::RequestProcessor;
use crate::{runtime::RuntimeCore, thread_state::ThreadStateManager};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Weak},
    time::Duration,
};
use tokio::sync::Mutex;

#[derive(Default)]
pub(super) struct CleanupQueue {
    state: Mutex<QueueState>,
    changed: Arc<tokio::sync::Notify>,
}

#[derive(Default)]
struct QueueState {
    desktop_connected: bool,
    loaded: bool,
    running: bool,
    saved: SavedQueue,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct SavedQueue {
    revision: u64,
    completed_revision: u64,
    buffer_start_ms: i64,
    attempts: u32,
    retry_after_ms: Option<i64>,
}

impl SavedQueue {
    fn pending(&self) -> bool {
        self.revision != self.completed_revision
    }
}

impl RequestProcessor {
    pub(super) async fn request_worktree_cleanup(&self) {
        let path = self
            .runtime
            .environment_registry_path()
            .with_file_name("worktree_cleanup.json");
        let mut state = self.worktree_cleanup.state.lock().await;
        state.desktop_connected |= self
            .client_info()
            .is_some_and(|client| client.name == "desktop");
        // 这是Desktop管理的后台工作，不因普通CLI/测试连接启动。
        if !state.desktop_connected {
            return;
        }
        if !state.loaded {
            match tokio::fs::read(&path).await {
                Ok(bytes) => match serde_json::from_slice(&bytes) {
                    Ok(saved) => state.saved = saved,
                    Err(error) => {
                        tracing::warn!(%error, "Invalid worktree cleanup queue");
                        return;
                    }
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    tracing::warn!(%error, "Cannot read worktree cleanup queue");
                    return;
                }
            }
            state.loaded = true;
        }
        state.saved.revision = state.saved.revision.wrapping_add(1);
        state.saved.attempts = 0;
        state.saved.retry_after_ms = None;
        if let Err(error) = persist(&path, &state.saved) {
            tracing::warn!(%error, "Cannot enqueue worktree cleanup");
            return;
        }
        if state.running {
            self.worktree_cleanup.changed.notify_one();
            return;
        }
        state.running = true;
        let queue = Arc::downgrade(&self.worktree_cleanup);
        let runtime = Arc::downgrade(&self.runtime);
        let threads = self.thread_states.clone();
        tokio::spawn(run(queue, runtime, threads, path));
    }
}

async fn run(
    queue: Weak<CleanupQueue>,
    runtime: Weak<RuntimeCore>,
    threads: ThreadStateManager,
    path: PathBuf,
) {
    loop {
        let Some(queue_owner) = queue.upgrade() else {
            return;
        };
        let Some(runtime_owner) = runtime.upgrade() else {
            return;
        };
        let plan_needed = runtime_owner.worktree_cleanup_plan_needed().await;
        let (revision, buffer_start) = {
            let mut state = queue_owner.state.lock().await;
            if !state.saved.pending() {
                state.running = false;
                return;
            }
            if state.saved.buffer_start_ms <= 0 && matches!(plan_needed, Ok(true)) {
                state.saved.buffer_start_ms = chrono::Utc::now().timestamp_millis();
                if let Err(error) = persist(&path, &state.saved) {
                    tracing::warn!(%error, "Cannot initialize worktree cleanup buffer");
                    state.running = false;
                    return;
                }
            }
            (state.saved.revision, state.saved.buffer_start_ms)
        };
        let result = match plan_needed {
            Err(error) => Err(error),
            Ok(_) => {
                runtime_owner
                    .cleanup_worktrees(buffer_start, |thread_id| {
                        let threads = threads.clone();
                        async move {
                            !threads
                                .subscribed_connection_ids(&agent_protocol::ThreadId::new(
                                    thread_id,
                                ))
                                .await
                                .is_empty()
                        }
                    })
                    .await
            }
        };
        drop(runtime_owner);
        let retry = match result {
            Ok(()) => {
                let mut state = queue_owner.state.lock().await;
                let previous = state.saved.completed_revision;
                state.saved.completed_revision = revision;
                state.saved.attempts = 0;
                state.saved.retry_after_ms = None;
                if let Err(error) = persist(&path, &state.saved) {
                    tracing::warn!(%error, "Cannot complete worktree cleanup queue");
                    state.saved.completed_revision = previous;
                    true
                } else {
                    false
                }
            }
            Err(error) => {
                tracing::warn!(%error, "Worktree cleanup deferred");
                let mut state = queue_owner.state.lock().await;
                if state.saved.revision == revision {
                    state.saved.attempts = state.saved.attempts.saturating_add(1);
                    let delay = (30_000 * 2_i64.pow(state.saved.attempts.min(5) - 1)).min(300_000);
                    state.saved.retry_after_ms =
                        Some(chrono::Utc::now().timestamp_millis() + delay);
                    if let Err(error) = persist(&path, &state.saved) {
                        tracing::warn!(%error, "Cannot persist deferred worktree cleanup");
                    }
                    true
                } else {
                    false
                }
            }
        };
        let changed = queue_owner.changed.clone();
        let delay = queue_owner
            .state
            .lock()
            .await
            .saved
            .retry_after_ms
            .map(|time| {
                time.saturating_sub(chrono::Utc::now().timestamp_millis())
                    .max(0) as u64
            })
            .unwrap_or(30_000);
        drop(queue_owner);
        // 仅重试尚未完成的请求；等待期间不延长processor/runtime的生命周期。
        if retry {
            tokio::select! { _ = tokio::time::sleep(Duration::from_millis(delay)) => {}, _ = changed.notified() => {} }
        }
    }
}

fn persist(path: &Path, state: &SavedQueue) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid cleanup queue path")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    serde_json::to_writer(file.as_file_mut(), state).map_err(|error| error.to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    file.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}
