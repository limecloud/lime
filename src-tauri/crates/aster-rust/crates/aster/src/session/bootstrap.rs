use super::{
    initialize_default_sqlite_session_runtime_store, install_global_session_store,
    is_global_session_store_set, load_runtime_snapshot_from_store, require_session_runtime_store,
    SessionRuntimeSnapshot, SessionStore, ThreadRuntimeStore,
};
use crate::config::paths::{initialize_path_root, Paths};
use anyhow::Result;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

pub async fn initialize_shared_session_runtime_with_root(
    root: PathBuf,
    session_store: Option<Arc<dyn SessionStore>>,
) -> Result<()> {
    initialize_path_root(root).map_err(anyhow::Error::msg)?;
    ensure_shared_session_runtime_dirs()?;

    if require_session_runtime_store().is_err() {
        initialize_default_sqlite_session_runtime_store();
    }

    if let Some(session_store) = session_store {
        ensure_global_session_store(session_store).await?;
    }

    Ok(())
}

pub fn require_shared_session_runtime_store() -> Result<Arc<dyn ThreadRuntimeStore>> {
    require_session_runtime_store()
}

pub async fn load_shared_session_runtime_snapshot(
    session_id: &str,
) -> Result<SessionRuntimeSnapshot> {
    let store = require_shared_session_runtime_store()?;
    load_managed_session_runtime_snapshot(store.as_ref(), session_id).await
}

pub async fn load_managed_session_runtime_snapshot(
    store: &(impl ThreadRuntimeStore + ?Sized),
    session_id: &str,
) -> Result<SessionRuntimeSnapshot> {
    load_runtime_snapshot_from_store(store, session_id).await
}

fn ensure_shared_session_runtime_dirs() -> Result<()> {
    for dir in [
        Paths::config_dir(),
        Paths::data_dir(),
        Paths::state_dir(),
        Paths::in_state_dir("logs"),
    ] {
        fs::create_dir_all(&dir)?;
    }

    Ok(())
}

async fn ensure_global_session_store(store: Arc<dyn SessionStore>) -> Result<()> {
    if is_global_session_store_set() {
        return Ok(());
    }

    if let Err(error) = install_global_session_store(store).await {
        if is_global_session_store_set() {
            return Ok(());
        }
        return Err(error);
    }

    Ok(())
}
