use super::*;
use std::cell::Cell;

fn watch_state(root: PathBuf) -> WatchState {
    WatchState {
        roots: Arc::new(Mutex::new(registration::RootRegistry::new([root]))),
        watcher: Mutex::new(Some(
            notify::recommended_watcher(|_: notify::Result<Event>| {}).unwrap(),
        )),
        watched: Mutex::new(HashMap::new()),
        rearm: Arc::new(Mutex::new(HashSet::new())),
    }
}

#[test]
fn catalog_invalidation_waits_for_missing_root_watch() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("missing").join("skills");
    let state = watch_state(root.clone());
    assert!(state.reconcile());
    let fallback = temp.path().canonicalize().unwrap();
    assert_eq!(
        state.watched.lock().unwrap().get(&fallback),
        Some(&RecursiveMode::NonRecursive)
    );

    fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let notified = Cell::new(false);
    reconcile_catalog_change(&state, true, || {
        let watched = state.watched.lock().unwrap();
        assert_eq!(watched.get(&root), Some(&RecursiveMode::Recursive));
        assert_eq!(
            watched.get(root.parent().unwrap()),
            Some(&RecursiveMode::NonRecursive)
        );
        assert!(!watched.contains_key(&fallback));
        notified.set(true);
    });
    assert!(notified.get());

    reconcile_catalog_change(&state, false, || panic!("idle tick must not invalidate"));
    let notified = Cell::new(false);
    reconcile_catalog_change(&state, true, || notified.set(true));
    assert!(
        notified.get(),
        "a file edit must invalidate an unchanged watch"
    );
}

#[test]
fn catalog_invalidation_waits_for_replaced_root_watch() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("skills");
    fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let state = watch_state(root.clone());
    assert!(state.reconcile());

    fs::rename(&root, temp.path().join("retired")).unwrap();
    fs::create_dir(&root).unwrap();
    state.rearm.lock().unwrap().insert(root.clone());
    let notified = Cell::new(false);
    reconcile_catalog_change(&state, true, || {
        assert!(state.rearm.lock().unwrap().is_empty());
        assert_eq!(
            state.watched.lock().unwrap().get(&root),
            Some(&RecursiveMode::Recursive)
        );
        notified.set(true);
    });
    assert!(notified.get());
}
