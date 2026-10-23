use super::{inventory::local_source, CATEGORIES};
use crate::runtime::{ProjectionStore, StorageRoots};
use agent_protocol::Thread;
use app_server_protocol::{
    ProjectGitWorktreeListResponse, StorageCategory as Category, StorageCategoryUsage,
    StorageState, StorageStatus, StorageUsage,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

pub(super) struct ScanPlan {
    roots: Vec<PathBuf>,
    sessions: PathBuf,
    archived: PathBuf,
    worktrees: Vec<PathBuf>,
    rollouts: BTreeMap<PathBuf, (String, Category)>,
    usage: StorageUsage,
}

impl ScanPlan {
    pub(super) fn new(
        roots: &StorageRoots,
        worktrees: &ProjectGitWorktreeListResponse,
        threads: &BTreeMap<String, Thread>,
        store: Option<&ProjectionStore>,
    ) -> Result<Self, String> {
        let app = directory(&roots.app_data_root)?;
        let data = directory(&roots.data_root)?;
        let mut bases = vec![app, data.clone()];
        let mut managed = Vec::new();
        for entry in &worktrees.worktrees {
            match fs::symlink_metadata(&entry.worktree_path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
                Ok(_) => {}
            }
            match directory(Path::new(&entry.worktree_path)) {
                Ok(path) => {
                    managed.push(path.clone());
                    bases.push(path);
                }
                Err(error) => return Err(error),
            }
        }
        let roots = disjoint_roots(bases);
        let mut rollouts = BTreeMap::new();
        let store = store.ok_or("canonical thread store is unavailable")?;
        for (id, thread) in threads {
            let Some(path) = store.rollout_path_for_thread_sync(&thread.thread_id)? else {
                continue;
            };
            let category = if thread.archived {
                Category::Archived
            } else if !local_source(thread) {
                Category::Unclassified
            } else if thread.parent_thread_id.is_some() {
                Category::Subagents
            } else {
                Category::Threads
            };
            // Plain and compressed files may coexist during publication; count actual bytes once each.
            let plain = if path.extension().is_some_and(|ext| ext == "zst") {
                path.with_extension("")
            } else {
                path
            };
            let mut compressed = plain.clone().into_os_string();
            compressed.push(".zst");
            for path in [plain, PathBuf::from(compressed)] {
                match fs::symlink_metadata(&path) {
                    Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {}
                    Ok(_) => return Err("canonical rollout is not a regular file".into()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(error.to_string()),
                }
                let path = fs::canonicalize(path.parent().ok_or("rollout has no parent")?)
                    .map_err(|e| e.to_string())?
                    .join(path.file_name().ok_or("rollout has no filename")?);
                if rollouts.insert(path, (id.clone(), category)).is_some() {
                    return Err("multiple canonical threads share a rollout".into());
                }
            }
        }
        Ok(Self {
            sessions: data.join("sessions"),
            archived: data.join("archived_sessions"),
            worktrees: disjoint_roots(managed),
            rollouts,
            usage: StorageUsage {
                data_root: data.to_string_lossy().into_owned(),
                worktree_root: worktrees.root_path.clone(),
                scanned_roots: roots
                    .iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect(),
                total_bytes: 0,
                categories: CATEGORIES
                    .into_iter()
                    .map(|category| StorageCategoryUsage { category, bytes: 0 })
                    .collect(),
                thread_bytes: BTreeMap::new(),
            },
            roots,
        })
    }
}

fn directory(path: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "storage root is not a real directory: {}",
            path.display()
        ));
    }
    fs::canonicalize(path).map_err(|e| e.to_string())
}

fn disjoint_roots(mut roots: Vec<PathBuf>) -> Vec<PathBuf> {
    roots.sort_by_key(|path| path.components().count());
    let mut result = Vec::<PathBuf>::new();
    for path in roots {
        if !result.iter().any(|root| path.starts_with(root)) {
            result.push(path);
        }
    }
    result
}

pub(super) fn measure(
    mut plan: ScanPlan,
    cancel: &AtomicBool,
    mut publish: impl FnMut(&StorageUsage, &[Category]),
) -> Result<(), String> {
    let mut completed = Vec::new();
    let mut incomplete = false;
    let stages = vec![
        (
            vec![plan.sessions.clone()],
            vec![],
            vec![
                Category::Threads,
                Category::Subagents,
                Category::Unclassified,
            ],
            Category::Unclassified,
        ),
        (
            vec![plan.archived.clone()],
            vec![],
            vec![Category::Archived],
            Category::Archived,
        ),
        (
            plan.worktrees.clone(),
            vec![plan.sessions.clone(), plan.archived.clone()],
            vec![Category::Worktrees],
            Category::Worktrees,
        ),
        (
            plan.roots.clone(),
            [
                vec![plan.sessions.clone(), plan.archived.clone()],
                plan.worktrees.clone(),
            ]
            .concat(),
            vec![Category::Other],
            Category::Other,
        ),
    ];
    publish(&plan.usage, &completed);
    for (roots, excluded, categories, fallback) in stages {
        let mut stage_ok = true;
        let mut count = 0;
        for root in roots {
            let result = walk(&root, &excluded, cancel, |path, bytes| {
                let (thread, category) = plan
                    .rollouts
                    .get(path)
                    .map(|(id, category)| (Some(id), *category))
                    .unwrap_or((None, fallback));
                plan.usage.total_bytes = plan.usage.total_bytes.saturating_add(bytes);
                let usage = plan
                    .usage
                    .categories
                    .iter_mut()
                    .find(|entry| entry.category == category)
                    .expect("known category");
                usage.bytes = usage.bytes.saturating_add(bytes);
                if let Some(id) = thread {
                    let total = plan.usage.thread_bytes.entry(id.clone()).or_default();
                    *total = total.saturating_add(bytes);
                }
                count += 1;
                if count % 64 == 0 {
                    publish(&plan.usage, &completed);
                }
            });
            if result.is_err() {
                stage_ok = false;
            }
            if cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
        }
        if stage_ok {
            completed.extend(categories);
        } else {
            incomplete = true;
        }
        publish(&plan.usage, &completed);
    }
    if incomplete {
        Err("storage scan is incomplete".into())
    } else {
        Ok(())
    }
}

// Sequential metadata reads stay below the reference's 32-operation bound.
// No file payload is read, and every directory entry rejects links before traversal.
fn walk(
    root: &Path,
    excluded: &[PathBuf],
    cancel: &AtomicBool,
    mut file: impl FnMut(&Path, u64),
) -> Result<(), String> {
    let mut pending = vec![root.to_path_buf()];
    let mut error = None;
    while let Some(path) = pending.pop() {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        if excluded.iter().any(|root| path.starts_with(root)) {
            continue;
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => {
                error = Some(e.to_string());
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_file() {
            file(&path, metadata.len());
        } else if metadata.is_dir() {
            match fs::read_dir(&path) {
                Ok(entries) => {
                    for entry in entries {
                        match entry {
                            Ok(entry) => pending.push(entry.path()),
                            Err(e) => error = Some(e.to_string()),
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => error = Some(e.to_string()),
            }
        }
    }
    error.map_or(Ok(()), Err)
}

#[derive(Serialize, Deserialize)]
struct Cache {
    version: u8,
    app_root: PathBuf,
    agent_root: PathBuf,
    state: StorageState,
}
pub(super) fn read_cache(roots: &StorageRoots) -> Option<StorageState> {
    cache_directory(roots).ok()?;
    let path = roots.runtime_root.join("storage.json");
    if fs::symlink_metadata(&path).ok()?.file_type().is_symlink() {
        return None;
    }
    let cache: Cache = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    let now = chrono::Utc::now().timestamp_millis();
    (cache.version == 1
        && cache.app_root == roots.app_data_root
        && cache.agent_root == roots.data_root
        && cache.state.status == StorageStatus::Ready
        && cache
            .state
            .measured_at
            .is_some_and(|at| at > 0 && at <= now)
        && cache.state.usage.is_some())
    .then_some(cache.state)
}
pub(super) fn write_cache(roots: &StorageRoots, state: &StorageState) -> Result<(), String> {
    cache_directory(roots)?;
    let cache = Cache {
        version: 1,
        app_root: roots.app_data_root.clone(),
        agent_root: roots.data_root.clone(),
        state: state.clone(),
    };
    let mut temp =
        tempfile::NamedTempFile::new_in(&roots.runtime_root).map_err(|e| e.to_string())?;
    temp.write_all(&serde_json::to_vec(&cache).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    temp.persist(roots.runtime_root.join("storage.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn cache_directory(roots: &StorageRoots) -> Result<(), String> {
    let data = directory(&roots.data_root)?;
    let cache = directory(&roots.runtime_root)?;
    if !cache.starts_with(data) {
        return Err("storage cache is outside the agent root".into());
    }
    Ok(())
}
