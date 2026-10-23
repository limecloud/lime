//! 本机容量投影。扫描结果只作测量缓存，不承接 Thread 或工作树事实。
mod inventory;
mod review;
mod scan;

use super::{RuntimeCore, RuntimeCoreError, StorageRoots};
use app_server_protocol::{StorageState, StorageStatus};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

#[derive(Default)]
pub(super) struct StorageScan {
    state: StorageState,
    generation: u64,
    cancel: Option<Arc<AtomicBool>>,
    cache_loaded: bool,
    attempted_at: Option<i64>,
}

impl RuntimeCore {
    pub fn with_storage_roots(mut self, roots: StorageRoots) -> Self {
        self.storage_roots = Some(roots);
        self.storage_scan = Arc::new(Mutex::new(StorageScan::default()));
        self
    }

    pub async fn read_storage(&self, refresh: bool) -> Result<StorageState, RuntimeCoreError> {
        let roots = self
            .storage_roots
            .clone()
            .ok_or_else(|| RuntimeCoreError::Backend("storage roots are unavailable".into()))?;
        let mut scan = self
            .storage_scan
            .lock()
            .expect("storage scan mutex poisoned");
        if !scan.cache_loaded {
            scan.cache_loaded = true;
            if let Some(cached) = scan::read_cache(&roots) {
                scan.state = cached;
            }
        }
        let now = chrono::Utc::now().timestamp_millis();
        let stale = scan
            .state
            .measured_at
            .is_none_or(|at| now.saturating_sub(at) > 60_000);
        let retry_due = scan.state.status != StorageStatus::Error
            || scan
                .attempted_at
                .is_none_or(|at| now.saturating_sub(at) > 60_000);
        if refresh || (scan.cancel.is_none() && stale && retry_due) {
            if let Some(cancel) = scan.cancel.take() {
                cancel.store(true, Ordering::Relaxed);
            }
            scan.generation += 1;
            scan.attempted_at = Some(now);
            let generation = scan.generation;
            let cancel = Arc::new(AtomicBool::new(false));
            scan.cancel = Some(cancel.clone());
            scan.state.status = StorageStatus::Scanning;
            // 旧容量仍可见；未完成的新一轮不能启用清理审阅。
            scan.state.completed_categories.clear();
            let runtime = self.clone();
            tokio::spawn(async move {
                let result = runtime.run_storage_scan(roots, generation, cancel).await;
                let mut scan = runtime
                    .storage_scan
                    .lock()
                    .expect("storage scan mutex poisoned");
                if scan.generation != generation {
                    return;
                }
                scan.cancel = None;
                match result {
                    Ok(()) => {
                        scan.state.status = StorageStatus::Ready;
                        scan.state.measured_at = Some(chrono::Utc::now().timestamp_millis());
                    }
                    Err(_) => scan.state.status = StorageStatus::Error,
                }
            });
        }
        Ok(scan.state.clone())
    }

    async fn run_storage_scan(
        &self,
        roots: StorageRoots,
        generation: u64,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), String> {
        let threads = self.storage_inventory().await.map_err(|e| e.to_string())?;
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        let worktrees = self
            .list_project_git_worktrees(Default::default())
            .await
            .map_err(|e| e.to_string())?;
        let plan = scan::ScanPlan::new(
            &roots,
            &worktrees,
            &threads,
            self.projection_store.as_deref(),
        )?;
        let state = self.storage_scan.clone();
        let cache_roots = roots.clone();
        tokio::task::spawn_blocking(move || {
            scan::measure(plan, &cancel, |usage, completed| {
                let mut scan = state.lock().expect("storage scan mutex poisoned");
                if scan.generation == generation {
                    scan.state.usage = Some(usage.clone());
                    scan.state.completed_categories = completed.to_vec();
                }
            })?;
            if cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
            let scan = state.lock().expect("storage scan mutex poisoned");
            if scan.generation == generation {
                let mut complete = scan.state.clone();
                complete.status = StorageStatus::Ready;
                complete.measured_at = Some(chrono::Utc::now().timestamp_millis());
                scan::write_cache(&cache_roots, &complete)?;
            }
            Ok::<_, String>(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

const CATEGORIES: [app_server_protocol::StorageCategory; 6] = [
    app_server_protocol::StorageCategory::Threads,
    app_server_protocol::StorageCategory::Subagents,
    app_server_protocol::StorageCategory::Archived,
    app_server_protocol::StorageCategory::Unclassified,
    app_server_protocol::StorageCategory::Worktrees,
    app_server_protocol::StorageCategory::Other,
];
