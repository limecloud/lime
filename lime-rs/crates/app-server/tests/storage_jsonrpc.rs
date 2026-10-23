//! 通过真实公开 JSON-RPC 验证本机统计、审阅与 canonical 子树删除。
use agent_protocol::{ThreadId, ThreadTurnsView};
use app_server::{AppServer, MockBackend, ProjectionStore, RuntimeCore, StorageRoots};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use serde_json::{json, Value};
use std::{
    fs::{self, File, FileTimes},
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant, UNIX_EPOCH},
};
use thread_store::{
    AgentGraphStore, CreateThreadParams, ReadThreadParams, ThreadSpawnEdgeStatus, ThreadStore,
};

struct Fixture {
    _temp: tempfile::TempDir,
    roots: StorageRoots,
    store: Arc<ProjectionStore>,
    server: AppServer,
    runtime: RuntimeCore,
}
impl Fixture {
    async fn new(portable: bool) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let app = temp.path().join("machine");
        let agent = if portable {
            temp.path().join("portable/agent")
        } else {
            app.join("app-server")
        };
        let roots = StorageRoots::initialize(&app, &agent).unwrap();
        fs::create_dir_all(&app).unwrap();
        let config = app.join("config.yaml");
        fs::write(&config, "language: en-US\n").unwrap();
        let store = Arc::new(
            ProjectionStore::initialize_with_storage_paths(
                &roots.projection_db_path,
                &roots.state_db_path,
                &roots.thread_history_db_path,
                &roots.data_root,
            )
            .unwrap(),
        );
        let runtime = RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(config)
            .with_projection_store(store.clone())
            .with_storage_roots(roots.clone());
        let server = initialize(runtime.clone()).await;
        Self {
            _temp: temp,
            roots,
            store,
            server,
            runtime,
        }
    }
    async fn seed(&self, id: &str, archived: bool, metadata: Value) -> PathBuf {
        let mut initial_metadata = metadata.clone();
        initial_metadata
            .as_object_mut()
            .unwrap()
            .remove("ephemeral");
        self.store.create_thread(CreateThreadParams { thread: serde_json::from_value(json!({
            "sessionId": id, "threadId": id, "status": {"type":"idle"}, "createdAtMs":1_000, "updatedAtMs":2_000,
            "archived":false,"name":id,"metadata":initial_metadata
        })).unwrap() }).await.unwrap();
        if archived {
            request(&self.server, "thread/archive", json!({"threadId":id})).await;
        }
        let conn = rusqlite::Connection::open(&self.roots.state_db_path).unwrap();
        conn.execute("UPDATE canonical_threads SET thread_json=json_set(thread_json,'$.metadata',json(?2)) WHERE thread_id=?1", rusqlite::params![id,metadata.to_string()]).unwrap();
        self.age(id);
        self.rollout(id)
    }
    fn rollout(&self, id: &str) -> PathBuf {
        let conn = rusqlite::Connection::open(&self.roots.state_db_path).unwrap();
        let relative: String = conn
            .query_row(
                "SELECT rollout_path FROM canonical_threads WHERE thread_id=?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        self.roots.data_root.join(relative)
    }
    fn age(&self, id: &str) {
        let conn = rusqlite::Connection::open(&self.roots.state_db_path).unwrap();
        conn.execute("UPDATE canonical_threads SET created_at_ms=1000, updated_at_ms=2000, thread_json=json_set(thread_json,'$.createdAtMs',1000,'$.updatedAtMs',2000) WHERE thread_id=?1", [id]).unwrap();
        File::options()
            .write(true)
            .open(self.rollout(id))
            .unwrap()
            .set_times(FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(2)))
            .unwrap();
    }
    async fn measured(&self) -> Value {
        measured(&self.server).await
    }
    async fn review(&self, archived_only: bool) -> Value {
        request(
            &self.server,
            "storage/review",
            json!({"days":90,"archivedOnly":archived_only}),
        )
        .await
    }
    async fn exists(&self, id: &str) -> bool {
        self.store
            .read_thread(ReadThreadParams {
                thread_id: ThreadId::new(id),
                include_archived: true,
                turns_view: ThreadTurnsView::NotLoaded,
            })
            .await
            .unwrap()
            .is_some()
    }
}

#[tokio::test]
async fn measurement_counts_injected_roots_once_and_does_not_follow_links() {
    for portable in [false, true] {
        let f = Fixture::new(portable).await;
        let plain = f.seed("chat", false, json!({})).await;
        let archived = f.seed("archived", true, json!({})).await;
        let child = f.seed("child", false, json!({})).await;
        f.store
            .upsert_thread_spawn_edge(
                ThreadId::new("chat"),
                ThreadId::new("child"),
                ThreadSpawnEdgeStatus::Open,
            )
            .await
            .unwrap();
        let orphan = f.roots.sessions_root.join("unclassified.jsonl");
        fs::write(&orphan, b"unknown").unwrap();
        let outside = f._temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        File::create(outside.join("secret"))
            .unwrap()
            .set_len(50_000_000)
            .unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, f.roots.app_data_root.join("link")).unwrap();
        let state = f.measured().await;
        let usage = &state["usage"];
        for (id, path) in [("chat", plain), ("archived", archived), ("child", child)] {
            assert_eq!(usage["threadBytes"][id], fs::metadata(path).unwrap().len());
        }
        let categories = usage["categories"].as_array().unwrap();
        assert_eq!(
            categories
                .iter()
                .find(|entry| entry["category"] == "unclassified")
                .unwrap()["bytes"],
            7
        );
        assert_eq!(
            categories
                .iter()
                .map(|entry| entry["bytes"].as_u64().unwrap())
                .sum::<u64>(),
            usage["totalBytes"].as_u64().unwrap()
        );
        assert_eq!(
            usage["scannedRoots"].as_array().unwrap().len(),
            if portable { 2 } else { 1 }
        );
        assert!(usage["totalBytes"].as_u64().unwrap() < 50_000_000);
        let cold = initialize(f.runtime.clone().with_storage_roots(f.roots.clone())).await;
        let cached = request(&cold, "storage/read", json!({})).await;
        assert_eq!(cached["status"], "ready");
        assert_eq!(cached["usage"], usage.clone());
    }
}

#[tokio::test]
async fn review_excludes_recent_active_unknown_ephemeral_and_pending_descendants() {
    let f = Fixture::new(true).await;
    for (id, archived, metadata) in [
        ("old", true, json!({})),
        ("ordinary", false, json!({})),
        ("unknown", true, json!({"source":"future"})),
        (
            "cloud",
            true,
            json!({"threadSource":"cloud_threads.create"}),
        ),
        (
            "unknown-feature",
            true,
            json!({"threadSource":"future_feature"}),
        ),
        ("ephemeral", true, json!({"ephemeral":true})),
        ("parent", true, json!({})),
        ("active", true, json!({})),
    ] {
        f.seed(id, archived, metadata).await;
    }
    let recent = f.seed("recent-file", true, json!({})).await;
    File::options()
        .write(true)
        .open(recent)
        .unwrap()
        .set_times(FileTimes::new().set_modified(std::time::SystemTime::now()))
        .unwrap();
    f.store
        .create_pending_thread_spawn_edge(
            ThreadId::new("parent"),
            ThreadId::new("pending"),
            "pending-session".to_string(),
        )
        .await
        .unwrap();
    let conn = rusqlite::Connection::open(&f.roots.state_db_path).unwrap();
    conn.execute(
        "UPDATE canonical_threads SET thread_json=json_set(thread_json,'$.status',json(?1)) WHERE thread_id='active'",
        [r#"{"type":"active","activeFlags":[]}"#],
    )
    .unwrap();
    f.measured().await;
    let archived = f.review(true).await;
    assert_eq!(ids(&archived), vec!["old"]);
    assert_eq!(ids(&f.review(false).await), vec!["old", "ordinary"]);
}

#[tokio::test]
async fn delete_revalidates_snapshots_and_uses_canonical_subtree_notifications() {
    let f = Fixture::new(false).await;
    for id in ["root", "child", "changed", "new-child"] {
        f.seed(id, true, json!({})).await;
    }
    f.store
        .upsert_thread_spawn_edge(
            ThreadId::new("root"),
            ThreadId::new("child"),
            ThreadSpawnEdgeStatus::Closed,
        )
        .await
        .unwrap();
    f.measured().await;
    let review = f.review(true).await;
    let roots = review["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["root"]["threadId"] != "new-child")
        .cloned()
        .collect::<Vec<_>>();
    let conn = rusqlite::Connection::open(&f.roots.state_db_path).unwrap();
    conn.execute(
        "UPDATE canonical_threads SET updated_at_ms=3000,thread_json=json_set(thread_json,'$.updatedAtMs',3000) WHERE thread_id='changed'",
        [],
    )
    .unwrap();
    let messages = raw_messages(
        &f.server,
        "storage/delete",
        json!({"cutoffMs":review["cutoffMs"],"archivedOnly":true,"candidates":roots}),
    )
    .await;
    let response = messages
        .iter()
        .find(|message| message.get("id").is_some())
        .unwrap();
    assert_eq!(
        response["result"],
        json!({"deleted":1,"skipped":1,"failed":0})
    );
    let mut deleted = messages
        .iter()
        .filter(|message| message["method"] == "thread/deleted")
        .map(|message| message["params"]["threadId"].as_str().unwrap())
        .collect::<Vec<_>>();
    deleted.sort();
    assert_eq!(deleted, vec!["child", "root"]);
    assert!(!f.exists("root").await && !f.exists("child").await);
    assert!(f.exists("changed").await && f.exists("new-child").await);
}

#[tokio::test]
async fn scan_failure_is_observable_until_refresh_and_then_recovers() {
    let f = Fixture::new(true).await;
    f.seed("old", true, json!({})).await;
    let mut roots = f.roots.clone();
    roots.app_data_root = f._temp.path().join("missing-machine-root");
    let server = initialize(f.runtime.clone().with_storage_roots(roots.clone())).await;
    request(&server, "storage/refresh", json!({})).await;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let state = request(&server, "storage/read", json!({})).await;
        if state["status"] == "error" {
            break;
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        request(&server, "storage/read", json!({})).await["status"],
        "error"
    );
    fs::create_dir(&roots.app_data_root).unwrap();
    assert_eq!(measured(&server).await["status"], "ready");
}

#[tokio::test]
async fn external_worktree_scope_includes_validated_checkouts_and_excludes_the_configured_parent() {
    use std::process::Command;
    let f = Fixture::new(false).await;
    let external = f._temp.path().join("external-worktrees");
    fs::create_dir(&external).unwrap();
    File::create(external.join("unrelated"))
        .unwrap()
        .set_len(50_000_000)
        .unwrap();
    request(
        &f.server,
        "config/value/write",
        json!({"keyPath":"worktrees.root","value":external,"mergeStrategy":"replace"}),
    )
    .await;
    let source = f._temp.path().join("source");
    fs::create_dir(&source).unwrap();
    for args in [
        vec!["init", "--template=", "--initial-branch=main"],
        vec![
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@localhost",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture",
        ],
    ] {
        let output = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let created = request(
        &f.server,
        "projectGit/worktree/create",
        json!({"rootPath":source,"name":"managed","baseBranch":"main"}),
    )
    .await;
    let checkout = PathBuf::from(created["worktreePath"].as_str().unwrap());
    fs::write(checkout.join("local"), vec![1_u8; 1234]).unwrap();
    let measured = f.measured().await;
    let usage = &measured["usage"];
    let canonical = fs::canonicalize(&checkout)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(usage["scannedRoots"]
        .as_array()
        .unwrap()
        .contains(&json!(canonical)));
    assert!(!usage["scannedRoots"]
        .as_array()
        .unwrap()
        .contains(&json!(external.to_string_lossy())));
    let worktrees = usage["categories"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["category"] == "worktrees")
        .unwrap();
    assert_eq!(
        worktrees["bytes"],
        1234 + fs::metadata(checkout.join(".git")).unwrap().len()
    );
    assert!(usage["totalBytes"].as_u64().unwrap() < 50_000_000);
}

#[tokio::test]
async fn review_walks_all_canonical_pages_without_truncation() {
    let f = Fixture::new(false).await;
    for index in 0..103 {
        f.seed(&format!("old-{index:03}"), false, json!({})).await;
    }
    f.measured().await;
    let review = f.review(false).await;
    assert_eq!(review["candidates"].as_array().unwrap().len(), 103);
    assert_eq!(ids(&review).first(), Some(&"old-000"));
    assert_eq!(ids(&review).last(), Some(&"old-102"));
}

#[tokio::test]
async fn newly_spawned_descendant_and_duplicate_roots_cannot_expand_a_reviewed_delete() {
    let f = Fixture::new(false).await;
    f.seed("root", true, json!({})).await;
    f.measured().await;
    let review = f.review(true).await;
    f.seed("child", true, json!({})).await;
    f.store
        .upsert_thread_spawn_edge(
            ThreadId::new("root"),
            ThreadId::new("child"),
            ThreadSpawnEdgeStatus::Closed,
        )
        .await
        .unwrap();
    let result=request(&f.server,"storage/delete",json!({"cutoffMs":review["cutoffMs"],"archivedOnly":true,"candidates":review["candidates"]})).await;
    assert_eq!(result["skipped"], 1);
    assert!(f.exists("root").await && f.exists("child").await);
    f.measured().await;
    let review = f.review(true).await;
    let entry = &review["candidates"][0];
    let messages = raw_messages(
        &f.server,
        "storage/delete",
        json!({"cutoffMs":review["cutoffMs"],"archivedOnly":true,"candidates":[entry,entry]}),
    )
    .await;
    assert!(messages
        .iter()
        .any(|message| message.get("error").is_some()));
    assert!(f.exists("root").await);
}

fn ids(review: &Value) -> Vec<&str> {
    review["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["root"]["threadId"].as_str().unwrap())
        .collect()
}
async fn initialize(runtime: RuntimeCore) -> AppServer {
    let server = AppServer::with_runtime(runtime);
    request(
        &server,
        METHOD_INITIALIZE,
        json!({"clientInfo":{"name":"storage-test","version":"1"}}),
    )
    .await;
    server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","method":METHOD_INITIALIZED,"params":{}}).to_string(),
        )
        .await
        .unwrap();
    server
}
async fn measured(server: &AppServer) -> Value {
    request(server, "storage/refresh", json!({})).await;
    let started = Instant::now();
    loop {
        let state = request(server, "storage/read", json!({})).await;
        if state["status"] != "scanning" {
            assert_eq!(state["status"], "ready", "{state}");
            return state;
        }
        assert!(started.elapsed() < Duration::from_secs(15));
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}
async fn request(server: &AppServer, method: &str, params: Value) -> Value {
    let messages = raw_messages(server, method, params).await;
    let result = messages
        .iter()
        .find(|line| line.get("id") == Some(&json!(1)))
        .unwrap();
    assert!(result.get("error").is_none(), "{method}: {result}");
    result["result"].clone()
}
async fn raw_messages(server: &AppServer, method: &str, params: Value) -> Vec<Value> {
    server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        )
        .await
        .unwrap()
        .iter()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}
