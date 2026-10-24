mod notifier;
mod registration;

use crate::{AppServerEventBridge, JsonRpcMessage};
use notifier::CatalogChangeNotifier;
use notify::{Event, EventKind, RecursiveMode, Watcher};
pub(crate) use registration::WatchRegistration;
use registration::WatchState;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

const WATCHER_THROTTLE_INTERVAL: Duration = Duration::from_secs(10);

pub(crate) struct SkillsWatcher {
    state: Arc<WatchState>,
    notifier: CatalogChangeNotifier,
    reconcile_task: tokio::task::JoinHandle<()>,
}

impl Drop for SkillsWatcher {
    fn drop(&mut self) {
        self.reconcile_task.abort();
        self.notifier.cancel_pending();
    }
}

impl SkillsWatcher {
    pub(crate) fn new(bridge: AppServerEventBridge) -> Option<Arc<Self>> {
        // Scope watches to runtime extras and loaded threads, as Codex does.
        Self::start(bridge, [], WATCHER_THROTTLE_INTERVAL)
    }

    pub(crate) fn register_runtime_extra_roots(&self, roots: impl IntoIterator<Item = PathBuf>) {
        self.state.replace_extra_roots(roots);
    }

    pub(crate) fn register_roots(
        &self,
        roots: impl IntoIterator<Item = PathBuf>,
    ) -> WatchRegistration {
        self.state.register(roots)
    }

    fn start(
        bridge: AppServerEventBridge,
        roots: impl IntoIterator<Item = PathBuf>,
        throttle_interval: Duration,
    ) -> Option<Arc<Self>> {
        let handle = match tokio::runtime::Handle::try_current() {
            Ok(handle) => handle,
            Err(error) => {
                tracing::warn!(%error, "skills watcher skipped without Tokio runtime");
                return None;
            }
        };
        let roots = Arc::new(Mutex::new(registration::RootRegistry::new(roots)));
        let rearm = Arc::new(Mutex::new(HashSet::new()));
        let signal = Arc::new(Notify::new());
        let notifier = CatalogChangeNotifier::new(bridge, handle, throttle_interval);
        let callback_roots = roots.clone();
        let callback_rearm = rearm.clone();
        let callback_signal = signal.clone();
        let watcher = match notify::recommended_watcher(move |result: notify::Result<Event>| {
            let event = match result {
                Ok(event) if is_catalog_change(&event.kind) => event,
                Ok(_) => return,
                Err(error) => {
                    tracing::warn!(%error, "skills watcher received an error");
                    return;
                }
            };
            let roots = callback_roots
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .paths();
            let relevant = roots.iter().any(|root| {
                event
                    .paths
                    .iter()
                    .any(|path| path.starts_with(root) || root.starts_with(path))
            });
            if !relevant {
                return;
            }
            // Parent watches also observe replacement of a root directory itself.
            callback_rearm
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .extend(
                    roots
                        .into_iter()
                        .filter(|root| event.paths.iter().any(|path| root.starts_with(path))),
                );
            callback_signal.notify_one();
        }) {
            Ok(watcher) => watcher,
            Err(error) => {
                tracing::warn!(%error, "failed to initialize skills watcher");
                return None;
            }
        };
        let state = Arc::new(WatchState {
            roots,
            watcher: Mutex::new(watcher),
            watched: Mutex::new(HashMap::new()),
            rearm,
        });
        state.reconcile();
        let reconcile_state = state.clone();
        let reconcile_notifier = notifier.clone();
        let reconcile_task = notifier.handle.spawn(async move {
            let mut interval = tokio::time::interval(throttle_interval);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            interval.tick().await;
            loop {
                let catalog_changed = tokio::select! {
                    _ = interval.tick() => false,
                    _ = signal.notified() => true,
                };
                reconcile_catalog_change(&reconcile_state, catalog_changed, || {
                    reconcile_notifier.notify();
                });
            }
        });
        Some(Arc::new(Self {
            state,
            notifier,
            reconcile_task,
        }))
    }
}

fn reconcile_catalog_change(state: &WatchState, catalog_changed: bool, notify: impl FnOnce()) {
    // Consumers may react immediately, so native watches must be ready first.
    let watch_changed = state.reconcile();
    if catalog_changed || watch_changed {
        notify();
    }
}

fn is_catalog_change(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Any | EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

#[cfg(test)]
mod tests;
