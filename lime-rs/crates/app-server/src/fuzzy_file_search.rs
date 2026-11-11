use app_server_protocol::error_codes;
use app_server_protocol::protocol::v2::{
    FuzzyFileSearchMatchType, FuzzyFileSearchParams, FuzzyFileSearchResponse, FuzzyFileSearchResult,
};
use app_server_protocol::JsonRpcError;
use file_search::create_session;
use file_search::FileSearchOptions;
use file_search::FileSearchSnapshot;
use file_search::MatchType as CrateMatchType;
use file_search::SessionReporter;
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::mpsc::Receiver;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;
use tokio::sync::Mutex;

const MATCH_LIMIT: usize = 50;

#[derive(Clone, Default)]
pub(crate) struct FuzzyFileSearchServer {
    pending: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl FuzzyFileSearchServer {
    pub(crate) async fn search(
        &self,
        params: FuzzyFileSearchParams,
    ) -> Result<FuzzyFileSearchResponse, JsonRpcError> {
        let roots = validate_roots(&params.roots).await?;
        if params.query.is_empty() || roots.is_empty() {
            return Ok(FuzzyFileSearchResponse { files: Vec::new() });
        }

        let cancellation_flag = self
            .replace_cancellation_flag(params.cancellation_token.as_deref())
            .await;
        let query = params.query;
        let search_flag = cancellation_flag.clone();
        let search = tokio::task::spawn_blocking(move || run_search(&query, roots, search_flag))
            .await
            .map_err(|error| runtime_error(format!("fuzzy file search task failed: {error}")));

        self.remove_cancellation_flag(params.cancellation_token.as_deref(), &cancellation_flag)
            .await;

        Ok(FuzzyFileSearchResponse { files: search? })
    }

    async fn replace_cancellation_flag(&self, token: Option<&str>) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        let Some(token) = token else {
            return flag;
        };
        if let Some(previous) = self
            .pending
            .lock()
            .await
            .insert(token.to_string(), flag.clone())
        {
            previous.store(true, AtomicOrdering::Relaxed);
        }
        flag
    }

    async fn remove_cancellation_flag(&self, token: Option<&str>, flag: &Arc<AtomicBool>) {
        let Some(token) = token else {
            return;
        };
        let mut pending = self.pending.lock().await;
        if pending
            .get(token)
            .is_some_and(|current| Arc::ptr_eq(current, flag))
        {
            pending.remove(token);
        }
    }
}

async fn validate_roots(roots: &[String]) -> Result<Vec<SearchRoot>, JsonRpcError> {
    let mut validated = Vec::with_capacity(roots.len());
    for root in roots {
        let path = PathBuf::from(root);
        if !path.is_absolute() {
            return Err(invalid_params(
                "fuzzyFileSearch.roots must be absolute paths",
            ));
        }
        let metadata = tokio::fs::metadata(&path).await.map_err(|error| {
            invalid_params(format!(
                "fuzzyFileSearch root is not readable: {}: {error}",
                path.display()
            ))
        })?;
        if !metadata.is_dir() {
            return Err(invalid_params(format!(
                "fuzzyFileSearch root must be a directory: {}",
                path.display()
            )));
        }
        validated.push(SearchRoot {
            wire: root.clone(),
            path,
        });
    }
    Ok(validated)
}

#[derive(Clone)]
struct SearchRoot {
    wire: String,
    path: PathBuf,
}

enum SearchEvent {
    Snapshot(FileSearchSnapshot),
    Complete,
}

struct CollectReporter {
    tx: std::sync::mpsc::Sender<SearchEvent>,
}

impl SessionReporter for CollectReporter {
    fn on_update(&self, snapshot: &FileSearchSnapshot) {
        let _ = self.tx.send(SearchEvent::Snapshot(snapshot.clone()));
    }

    fn on_complete(&self) {
        let _ = self.tx.send(SearchEvent::Complete);
    }
}

fn run_search(
    query: &str,
    roots: Vec<SearchRoot>,
    canceled: Arc<AtomicBool>,
) -> Vec<FuzzyFileSearchResult> {
    if roots.is_empty() || canceled.load(AtomicOrdering::Relaxed) {
        return Vec::new();
    }
    let directories = roots
        .iter()
        .map(|root| root.path.clone())
        .collect::<Vec<_>>();
    let options = FileSearchOptions {
        limit: NonZeroUsize::new(MATCH_LIMIT).unwrap_or(NonZeroUsize::MIN),
        exclude: Vec::new(),
        threads: NonZeroUsize::new(2).unwrap_or(NonZeroUsize::MIN),
        compute_indices: true,
        respect_gitignore: true,
    };
    let (tx, rx) = std::sync::mpsc::channel();
    let Ok(session) = create_session(
        directories,
        options,
        Arc::new(CollectReporter { tx }),
        Some(canceled.clone()),
    ) else {
        return Vec::new();
    };
    session.update_query(query);
    let snapshot = wait_for_snapshot(&rx, query, &canceled);
    drop(session);
    let Some(snapshot) = snapshot else {
        return Vec::new();
    };
    snapshot
        .matches
        .iter()
        .filter_map(|file_match| map_match(&roots, file_match))
        .collect()
}

fn wait_for_snapshot(
    rx: &Receiver<SearchEvent>,
    query: &str,
    canceled: &AtomicBool,
) -> Option<FileSearchSnapshot> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut latest: Option<FileSearchSnapshot> = None;
    loop {
        if canceled.load(AtomicOrdering::Relaxed) {
            return None;
        }
        let complete = latest
            .as_ref()
            .is_some_and(|snapshot| snapshot.query == query && snapshot.walk_complete);
        if complete {
            return latest;
        }
        if Instant::now() >= deadline {
            return latest;
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(SearchEvent::Snapshot(snapshot)) => latest = Some(snapshot),
            Ok(SearchEvent::Complete) => {
                if latest
                    .as_ref()
                    .is_some_and(|snapshot| snapshot.query == query && snapshot.walk_complete)
                {
                    return latest;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return latest,
        }
    }
}

fn map_match(
    roots: &[SearchRoot],
    file_match: &file_search::FileMatch,
) -> Option<FuzzyFileSearchResult> {
    let root = roots
        .iter()
        .find(|candidate| candidate.path == file_match.root)?;
    let relative = file_match
        .path
        .strip_prefix(&file_match.root)
        .unwrap_or(&file_match.path);
    let relative_path = relative.to_string_lossy().into_owned();
    let file_name = relative
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| relative_path.clone());
    Some(FuzzyFileSearchResult {
        root: root.wire.clone(),
        file_name,
        path: relative_path,
        match_type: match file_match.match_type {
            CrateMatchType::File => FuzzyFileSearchMatchType::File,
            CrateMatchType::Directory => FuzzyFileSearchMatchType::Directory,
        },
        score: file_match.score,
        indices: file_match.indices.clone(),
    })
}

fn invalid_params(message: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(error_codes::INVALID_PARAMS, message)
}

fn runtime_error(message: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(error_codes::RUNTIME_ERROR, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_preserves_relative_paths_and_match_metadata() {
        let temp = tempfile::tempdir().expect("fuzzy search temp dir");
        std::fs::create_dir_all(temp.path().join("src")).expect("create src");
        std::fs::write(temp.path().join("src/app.rs"), "app").expect("write app");
        std::fs::write(temp.path().join("src/apple.rs"), "apple").expect("write apple");
        let root = SearchRoot {
            wire: temp.path().to_string_lossy().into_owned(),
            path: temp.path().to_path_buf(),
        };

        let results = run_search("app", vec![root], Arc::new(AtomicBool::new(false)));

        assert!(results.iter().any(|result| result.path == "src/app.rs"));
        assert!(results.iter().any(|result| result.path == "src/apple.rs"));
        let app = results
            .iter()
            .find(|result| result.path == "src/app.rs")
            .expect("src/app.rs match");
        assert_eq!(app.file_name, "app.rs");
        assert_eq!(app.match_type, FuzzyFileSearchMatchType::File);
        assert!(app
            .indices
            .as_ref()
            .is_some_and(|indices| !indices.is_empty()));
    }

    #[test]
    fn canceled_search_returns_no_results() {
        let temp = tempfile::tempdir().expect("fuzzy search temp dir");
        std::fs::write(temp.path().join("app.rs"), "app").expect("write app");
        let root = SearchRoot {
            wire: temp.path().to_string_lossy().into_owned(),
            path: temp.path().to_path_buf(),
        };
        let canceled = Arc::new(AtomicBool::new(true));

        assert!(run_search("app", vec![root], canceled).is_empty());
    }

    #[tokio::test]
    async fn cancellation_token_replacement_only_removes_the_current_request() {
        let server = FuzzyFileSearchServer::default();
        let first = server.replace_cancellation_flag(Some("composer")).await;
        let second = server.replace_cancellation_flag(Some("composer")).await;

        assert!(first.load(AtomicOrdering::Relaxed));
        assert!(!second.load(AtomicOrdering::Relaxed));

        server
            .remove_cancellation_flag(Some("composer"), &first)
            .await;
        assert!(server
            .pending
            .lock()
            .await
            .get("composer")
            .is_some_and(|current| Arc::ptr_eq(current, &second)));

        server
            .remove_cancellation_flag(Some("composer"), &second)
            .await;
        assert!(!server.pending.lock().await.contains_key("composer"));
    }
}
