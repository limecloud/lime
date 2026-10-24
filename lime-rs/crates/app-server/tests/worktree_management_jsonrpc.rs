use agent_protocol::{Thread, ThreadId, ThreadStatus, ThreadTurnsView};
use app_server::{AppServer, MockBackend, ProjectionStore, RuntimeCore};
use app_server_protocol::protocol::v0::{
    METHOD_PROJECT_GIT_WORKTREE_CREATE, METHOD_PROJECT_GIT_WORKTREE_DELETE,
    METHOD_PROJECT_GIT_WORKTREE_LIST,
};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};
use thread_store::{CreateThreadParams, ReadThreadParams, ThreadStore, PINNED_THREAD_SECTION_ID};

#[path = "worktree_management/cleanup.rs"]
mod cleanup;

struct Fixture {
    temp: tempfile::TempDir,
    config: PathBuf,
    store: Arc<ProjectionStore>,
    server: AppServer,
    runtime: RuntimeCore,
    source: PathBuf,
}

impl Fixture {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.yaml");
        std::fs::write(&config, "language: en-US\n").unwrap();
        let store =
            Arc::new(ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap());
        let source = temp.path().join("source");
        std::fs::create_dir(&source).unwrap();
        git(&source, &["init", "--template=", "--initial-branch=main"]);
        git(
            &source,
            &[
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
        );
        let runtime = RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(config.clone())
            .with_projection_store(store.clone());
        let server = initialized_runtime(runtime.clone()).await;
        Self {
            temp,
            config,
            store,
            server,
            runtime,
            source,
        }
    }

    async fn create(&self, name: &str) -> PathBuf {
        let result = request(
            &self.server,
            METHOD_PROJECT_GIT_WORKTREE_CREATE,
            json!({"rootPath": self.source, "name": name, "baseBranch": "main"}),
        )
        .await;
        PathBuf::from(result["worktreePath"].as_str().unwrap())
    }

    async fn seed(&self, id: &str, cwd: &Path, pinned: bool, active: bool, archived: bool) {
        let mut thread: Thread = serde_json::from_value(json!({
            "sessionId": id, "threadId": id, "status": {"type": "idle"},
            "createdAtMs": 1, "updatedAtMs": 2, "archived": archived,
            "name": id, "metadata": {"workingDir": cwd}
        }))
        .unwrap();
        if active {
            thread.status = ThreadStatus::Active {
                active_flags: vec![],
            };
        }
        self.store
            .create_thread(CreateThreadParams { thread })
            .await
            .unwrap();
        if pinned {
            request(
                &self.server,
                "thread/section/move",
                json!({"threadId": id, "sectionId": PINNED_THREAD_SECTION_ID}),
            )
            .await;
        }
    }

    async fn archived(&self, id: &str) -> bool {
        self.store
            .read_thread(ReadThreadParams {
                thread_id: ThreadId::new(id),
                include_archived: true,
                turns_view: ThreadTurnsView::NotLoaded,
            })
            .await
            .unwrap()
            .unwrap()
            .archived
    }
}

#[tokio::test]
async fn list_reads_canonical_pages_and_cold_state_without_creating_missing_root() {
    let fixture = Fixture::new().await;
    let empty = request(&fixture.server, METHOD_PROJECT_GIT_WORKTREE_LIST, json!({})).await;
    assert_eq!(empty["worktrees"], json!([]));
    assert!(!fixture.temp.path().join("worktrees").exists());
    assert!(
        !fixture.temp.path().join("worktree_cleanup.json").exists(),
        "Ordinary clients do not start Desktop background cleanup"
    );
    let target = fixture.create("first").await;
    fixture
        .seed("associated", &target.join("nested"), true, false, false)
        .await;
    fixture.seed("archived", &target, false, false, true).await;
    // 让关联记录落到第二页；同名前缀的相邻目录不应关联。
    for i in 0..101 {
        fixture
            .seed(
                &format!("other-{i:03}"),
                &fixture.source,
                false,
                false,
                false,
            )
            .await;
    }
    fixture
        .seed(
            "sibling",
            &PathBuf::from(format!("{}-sibling", target.display())),
            false,
            false,
            false,
        )
        .await;
    let listed = request(&fixture.server, METHOD_PROJECT_GIT_WORKTREE_LIST, json!({})).await;
    assert_eq!(listed["worktrees"].as_array().unwrap().len(), 1);
    let chats = listed["worktrees"][0]["threads"].as_array().unwrap();
    assert_eq!(chats.len(), 2);
    assert!(chats
        .iter()
        .any(|chat| chat["threadId"] == "associated" && chat["pinned"] == true));
    assert!(chats
        .iter()
        .any(|chat| chat["threadId"] == "archived" && chat["archived"] == true));
    let cold = server(
        &fixture.config,
        Arc::new(
            ProjectionStore::initialize(fixture.temp.path().join("projection.sqlite")).unwrap(),
        ),
    )
    .await;
    assert_eq!(
        request(&cold, METHOD_PROJECT_GIT_WORKTREE_LIST, json!({})).await,
        listed
    );
}

#[tokio::test]
async fn deletion_rechecks_fixed_and_active_without_archiving_on_rejection() {
    let fixture = Fixture::new().await;
    for (name, pinned, active, dirty) in [
        ("pinned", true, false, false),
        ("active", false, true, false),
    ] {
        let target = fixture.create(name).await;
        fixture.seed(name, &target, pinned, active, false).await;
        if dirty {
            std::fs::write(target.join("keep.txt"), "local data").unwrap();
        }
        let listed = request(&fixture.server, METHOD_PROJECT_GIT_WORKTREE_LIST, json!({})).await;
        let row = listed["worktrees"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["worktreePath"].as_str() == target.to_str())
            .unwrap();
        assert_eq!(row["threads"][0]["pinned"], pinned);
        assert_eq!(row["threads"][0]["active"], active);
        let mut notifications = fixture.server.subscribe_outbound_messages();
        let rejected = raw(
            &fixture.server,
            METHOD_PROJECT_GIT_WORKTREE_DELETE,
            json!({"rootPath": target}),
        )
        .await;
        assert!(rejected.get("error").is_some(), "{name}: {rejected}");
        assert!(target.exists());
        assert!(!fixture.archived(name).await);
        assert!(archived_notifications(&mut notifications).is_empty());
    }
    for invalid in [
        json!({"rootPath": fixture.source}),
        json!({"rootPath": "relative"}),
        json!({"rootPath": fixture.source, "discardChanges": true}),
    ] {
        assert!(
            raw(&fixture.server, METHOD_PROJECT_GIT_WORKTREE_DELETE, invalid)
                .await
                .get("error")
                .is_some()
        );
    }
}

#[tokio::test]
async fn successful_targeted_delete_archives_only_associated_chats_and_persists_after_restart() {
    let fixture = Fixture::new().await;
    let target = fixture.create("remove").await;
    let keep = fixture.create("keep").await;
    fixture
        .seed("archive-me", &target, false, false, false)
        .await;
    fixture
        .seed("already-archived", &target, false, false, true)
        .await;
    fixture.seed("keep-me", &keep, false, false, false).await;
    let mut notifications = fixture.server.subscribe_outbound_messages();
    let removed = request(
        &fixture.server,
        METHOD_PROJECT_GIT_WORKTREE_DELETE,
        json!({"rootPath": target}),
    )
    .await;
    assert_eq!(removed["worktreePath"].as_str(), target.to_str());
    assert_eq!(removed["archivedThreadIds"], json!(["archive-me"]));
    assert!(!target.exists());
    assert!(keep.exists());
    assert!(fixture.archived("archive-me").await);
    assert!(!fixture.archived("keep-me").await);
    assert_eq!(
        archived_notifications(&mut notifications),
        vec!["archive-me"]
    );
    assert!(raw(
        &fixture.server,
        METHOD_PROJECT_GIT_WORKTREE_DELETE,
        json!({"rootPath": target})
    )
    .await
    .get("error")
    .is_some());
    let cold = server(
        &fixture.config,
        Arc::new(
            ProjectionStore::initialize(fixture.temp.path().join("projection.sqlite")).unwrap(),
        ),
    )
    .await;
    let listed = request(&cold, METHOD_PROJECT_GIT_WORKTREE_LIST, json!({})).await;
    assert_eq!(listed["worktrees"].as_array().unwrap().len(), 1);
    assert_eq!(
        listed["worktrees"][0]["worktreePath"].as_str(),
        keep.to_str()
    );
}

#[tokio::test]
async fn archive_lifecycle_runs_before_a_later_git_failure_and_is_not_replayed_on_retry() {
    let fixture = Fixture::new().await;
    let target = fixture.create("changed-after-archive").await;
    fixture
        .seed("archived-before-failure", &target, false, false, false)
        .await;
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let observed = seen.clone();
    let dirty = target.join("keep-after-archive.txt");
    let callback_file = dirty.clone();
    let server = &fixture.server;
    let error = fixture
        .runtime
        .delete_project_git_worktree(
            app_server_protocol::ProjectGitWorktreeDeleteParams {
                root_path: target.to_str().unwrap().into(),
            },
            move |id| {
                let observed = observed.clone();
                let file = callback_file.clone();
                async move {
                    observed.lock().unwrap().push(id);
                    std::fs::write(file, "new local data").unwrap();
                    request(server, "thread/section/move", json!({"threadId": "archived-before-failure", "sectionId": PINNED_THREAD_SECTION_ID})).await;
                }
            },
            app_server_transport::ConnectionId(0),
            || false,
        )
        .await;
    assert!(error.is_err());
    assert!(fixture.archived("archived-before-failure").await);
    assert_eq!(*seen.lock().unwrap(), vec!["archived-before-failure"]);
    assert_eq!(std::fs::read_to_string(dirty).unwrap(), "new local data");
    let mut notifications = fixture.server.subscribe_outbound_messages();
    assert!(raw(
        &fixture.server,
        METHOD_PROJECT_GIT_WORKTREE_DELETE,
        json!({"rootPath": target})
    )
    .await
    .get("error")
    .is_some());
    assert!(archived_notifications(&mut notifications).is_empty());
}

fn archived_notifications(
    receiver: &mut tokio::sync::broadcast::Receiver<app_server_protocol::JsonRpcMessage>,
) -> Vec<String> {
    let mut result = Vec::new();
    while let Ok(message) = receiver.try_recv() {
        if let app_server_protocol::JsonRpcMessage::Notification(notification) = message {
            if notification.method == "thread/archived" {
                result.push(
                    notification.params.unwrap()["threadId"]
                        .as_str()
                        .unwrap()
                        .to_owned(),
                );
            }
        }
    }
    result
}

#[tokio::test]
async fn cold_unarchive_restores_the_deleted_worktree_and_keeps_canonical_identity() {
    let fixture = Fixture::new().await;
    std::fs::write(fixture.source.join("README.md"), "recover this file\n").unwrap();
    git(&fixture.source, &["add", "README.md"]);
    git(
        &fixture.source,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@localhost",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "Recovery file",
        ],
    );
    let target = fixture.create("recover").await;
    fixture
        .seed("recover-chat", &target, false, false, false)
        .await;
    fixture
        .seed("older-archived", &target, false, false, true)
        .await;
    request(
        &fixture.server,
        METHOD_PROJECT_GIT_WORKTREE_DELETE,
        json!({ "rootPath": target }),
    )
    .await;
    assert!(!target.exists());
    assert!(fixture.archived("recover-chat").await);
    let cold = server(
        &fixture.config,
        Arc::new(ProjectionStore::initialize(fixture.store.path()).unwrap()),
    )
    .await;
    // 恢复失败保留归档状态和被占用目录，不能覆盖用户新文件。
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("keep.txt"), "keep local data").unwrap();
    assert!(raw(
        &cold,
        "thread/unarchive",
        json!({ "threadId": "recover-chat" })
    )
    .await
    .get("error")
    .is_some());
    assert!(fixture.archived("recover-chat").await);
    assert_eq!(
        std::fs::read_to_string(target.join("keep.txt")).unwrap(),
        "keep local data"
    );
    std::fs::remove_file(target.join("keep.txt")).unwrap();
    std::fs::remove_dir(&target).unwrap();
    let restored = request(
        &cold,
        "thread/unarchive",
        json!({ "threadId": "recover-chat" }),
    )
    .await;
    assert_eq!(restored["thread"]["id"], "recover-chat");
    assert_eq!(restored["thread"]["sessionId"], "recover-chat");
    assert_eq!(
        std::fs::read_to_string(target.join("README.md")).unwrap(),
        "recover this file\n"
    );
    assert!(!fixture.archived("recover-chat").await);
    // 同一工作树的其他旧归档聊天可独立恢复；现有本地修改必须保留。
    std::fs::write(target.join("README.md"), "new user edits\n").unwrap();
    request(
        &cold,
        "thread/unarchive",
        json!({ "threadId": "older-archived" }),
    )
    .await;
    assert_eq!(
        std::fs::read_to_string(target.join("README.md")).unwrap(),
        "new user edits\n"
    );
}

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn server(config: &Path, store: Arc<ProjectionStore>) -> AppServer {
    initialized_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(config.to_path_buf())
            .with_projection_store(store),
    )
    .await
}

async fn initialized_runtime(runtime: RuntimeCore) -> AppServer {
    let server = AppServer::with_runtime(runtime);
    request(
        &server,
        METHOD_INITIALIZE,
        json!({"clientInfo": {"name": "worktree-management-test", "version": "1"}}),
    )
    .await;
    server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}}).to_string(),
        )
        .await
        .unwrap();
    server
}

async fn request(server: &AppServer, method: &str, params: Value) -> Value {
    let result = raw(server, method, params).await;
    assert!(result.get("error").is_none(), "{method}: {result}");
    result["result"].clone()
}

async fn raw(server: &AppServer, method: &str, params: Value) -> Value {
    server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).to_string(),
        )
        .await
        .unwrap()
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|line| line.get("id") == Some(&json!(1)))
        .unwrap()
}
