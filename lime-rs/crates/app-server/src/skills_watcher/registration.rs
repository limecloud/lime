use super::*;
use notify::RecommendedWatcher;
use std::sync::Weak;

pub(super) struct RootRegistry {
    defaults: HashSet<PathBuf>,
    extra: HashSet<PathBuf>,
    registrations: HashMap<u64, HashSet<PathBuf>>,
    next_id: u64,
}

impl RootRegistry {
    pub(super) fn new(defaults: impl IntoIterator<Item = PathBuf>) -> Self {
        Self {
            defaults: normalize_roots(defaults),
            extra: HashSet::new(),
            registrations: HashMap::new(),
            next_id: 0,
        }
    }

    pub(super) fn paths(&self) -> HashSet<PathBuf> {
        self.defaults
            .iter()
            .chain(&self.extra)
            .chain(self.registrations.values().flatten())
            .cloned()
            .collect()
    }
}

pub(crate) struct WatchRegistration {
    state: Weak<WatchState>,
    id: u64,
}

impl Drop for WatchRegistration {
    fn drop(&mut self) {
        if let Some(state) = self.state.upgrade() {
            state
                .roots
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .registrations
                .remove(&self.id);
            state.reconcile();
        }
    }
}

pub(super) struct WatchState {
    pub(super) roots: Arc<Mutex<RootRegistry>>,
    pub(super) watcher: Mutex<Option<RecommendedWatcher>>,
    pub(super) watched: Mutex<HashMap<PathBuf, RecursiveMode>>,
    pub(super) rearm: Arc<Mutex<HashSet<PathBuf>>>,
}

impl WatchState {
    pub(super) fn shutdown(&self) {
        let watcher = self
            .watcher
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        self.watched
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
        self.roots
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .registrations
            .clear();
        // FSEvents restarts its stream for each unwatch. Shutdown releases the
        // native watcher once instead of rebuilding it for every registration.
        drop(watcher);
    }

    pub(super) fn replace_extra_roots(&self, roots: impl IntoIterator<Item = PathBuf>) {
        self.roots
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .extra = normalize_roots(roots);
        self.reconcile();
    }

    pub(super) fn register(
        self: &Arc<Self>,
        paths: impl IntoIterator<Item = PathBuf>,
    ) -> WatchRegistration {
        let id = {
            let mut roots = self.roots.lock().unwrap_or_else(|error| error.into_inner());
            let id = roots.next_id;
            roots.next_id = id
                .checked_add(1)
                .expect("Skill watch registration exhausted");
            roots.registrations.insert(id, normalize_roots(paths));
            id
        };
        self.reconcile();
        WatchRegistration {
            state: Arc::downgrade(self),
            id,
        }
    }

    pub(super) fn reconcile(&self) -> bool {
        let mut watcher = self
            .watcher
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(watcher) = watcher.as_mut() else {
            return false;
        };
        let roots = self
            .roots
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .paths();
        let expected = watch_paths(&roots);
        let rearm =
            std::mem::take(&mut *self.rearm.lock().unwrap_or_else(|error| error.into_inner()));
        let mut watched = self
            .watched
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let removed = watched
            .iter()
            .filter(|(path, mode)| expected.get(*path) != Some(*mode) || rearm.contains(*path))
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>();
        let added = expected
            .into_iter()
            .filter(|(path, _)| !watched.contains_key(path) || removed.contains(path))
            .collect::<Vec<_>>();
        if removed.is_empty() && added.is_empty() {
            return false;
        }
        // Apply the whole scope change in one native transaction. In particular,
        // FSEvents must not stop and restart its stream once for every path.
        let mut paths = watcher.paths_mut();
        for path in removed {
            if let Err(error) = paths.remove(&path) {
                tracing::debug!(path = %path.display(), %error, "Skill path was already unwatched");
            }
            watched.remove(&path);
        }
        for (path, mode) in added {
            match paths.add(&path, mode) {
                Ok(()) => {
                    watched.insert(path, mode);
                }
                Err(error) => {
                    tracing::warn!(path = %path.display(), %error, "failed to watch Skill path");
                }
            }
        }
        if let Err(error) = paths.commit() {
            tracing::warn!(%error, "failed to commit Skill watch scope");
        }
        true
    }
}

fn normalize_roots(roots: impl IntoIterator<Item = PathBuf>) -> HashSet<PathBuf> {
    roots
        .into_iter()
        .map(|root| {
            for ancestor in root.ancestors() {
                if let Ok(canonical) = std::fs::canonicalize(ancestor) {
                    return canonical.join(root.strip_prefix(ancestor).expect("root ancestor"));
                }
            }
            root
        })
        .collect()
}

fn watch_paths(roots: &HashSet<PathBuf>) -> HashMap<PathBuf, RecursiveMode> {
    let mut paths = HashMap::new();
    for root in roots {
        if root.is_dir() {
            paths.insert(root.clone(), RecursiveMode::Recursive);
        }
        if let Some(parent) = root.ancestors().skip(1).find(|parent| parent.is_dir()) {
            paths
                .entry(parent.to_path_buf())
                .or_insert(RecursiveMode::NonRecursive);
        }
    }
    paths
}
