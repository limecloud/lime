//! 真实JSON-RPC与Git自动清理集成场景。
use super::*;
use app_server_protocol::protocol::v2::METHOD_CONFIG_BATCH_WRITE;
use std::time::{Duration, Instant};

async fn desktop(runtime: RuntimeCore) -> AppServer {
    let server = AppServer::with_runtime(runtime);
    request(
        &server,
        METHOD_INITIALIZE,
        json!({"clientInfo": {"name": "lime_desktop_electron", "version": "1"}}),
    )
    .await;
    server
        .handle_json_line(&json!({"jsonrpc":"2.0", "method": METHOD_INITIALIZED}).to_string())
        .await
        .unwrap();
    server
}

async fn wait_queue(fixture: &Fixture, pending: bool) -> Value {
    let path = fixture.temp.path().join("worktree_cleanup.json");
    let start = Instant::now();
    loop {
        if let Ok(bytes) = std::fs::read(&path) {
            let value: Value = serde_json::from_slice(&bytes).unwrap();
            if (value["revision"] != value["completedRevision"]) == pending
                && (!pending || value["retryAfterMs"].is_i64())
            {
                return value;
            }
        }
        assert!(
            start.elapsed() < Duration::from_secs(15),
            "cleanup queue did not settle"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn enable(server: &AppServer, enabled: bool, keep: u32) {
    request(
        server,
        METHOD_CONFIG_BATCH_WRITE,
        json!({"edits":[
            {"keyPath":"worktrees.auto-cleanup-enabled","value":enabled,"mergeStrategy":"replace"},
            {"keyPath":"worktrees.keep-count","value":keep,"mergeStrategy":"replace"}
        ]}),
    )
    .await;
}

#[tokio::test]
async fn desktop_cleanup_snapshots_dirty_files_without_archiving_and_keeps_protected_extras() {
    let fixture = Fixture::new().await;
    // seed使用相同活动时间，候选按路径打破平局。
    let old = fixture.create("a-old").await;
    let keep = fixture.create("z-keep").await;
    let pin = fixture.create("pin").await;
    let active = fixture.create("active").await;
    let newborn = fixture.create("newborn").await;
    // 恢复必须有真实session，不能用只有Thread投影的seed冒充可resume聊天。
    let old_thread = request(
        &fixture.server,
        "thread/start",
        json!({"cwd":old, "model":"fixture-model", "modelProvider":"fixture-provider"}),
    )
    .await;
    let old_id = old_thread["thread"]["id"].as_str().unwrap();
    request(
        &fixture.server,
        "thread/start",
        json!({"cwd":keep, "model":"fixture-model", "modelProvider":"fixture-provider"}),
    )
    .await;
    fixture
        .seed("pin", &pin.join("nested"), true, false, false)
        .await;
    fixture.seed("active", &active, false, true, false).await;
    std::fs::write(old.join("local.txt"), "recover dirty data").unwrap();
    let desktop = desktop(fixture.runtime.clone()).await;
    wait_queue(&fixture, false).await;
    let mut notifications = desktop.subscribe_outbound_messages();
    enable(&desktop, true, 1).await;
    wait_queue(&fixture, false).await;
    assert!(!old.exists());
    assert!(keep.exists() && pin.exists() && active.exists() && newborn.exists());
    assert!(!fixture.archived(old_id).await);
    assert!(archived_notifications(&mut notifications).is_empty());
    request(&desktop, "thread/resume", json!({"threadId":old_id})).await;
    assert_eq!(
        std::fs::read_to_string(old.join("local.txt")).unwrap(),
        "recover dirty data"
    );
    assert!(!fixture.archived(old_id).await);
}

#[tokio::test]
async fn rollout_recency_uses_the_real_agent_root_instead_of_the_process_directory() {
    use std::fs::{File, FileTimes};
    use std::time::{SystemTime, UNIX_EPOCH};
    let fixture = Fixture::new().await;
    let recent = fixture.create("a-recent").await;
    let stale = fixture.create("z-stale").await;
    let agent_root = fixture.temp.path().join("separate-agent-root");
    let store = Arc::new(
        ProjectionStore::initialize_with_agent_root(
            fixture.temp.path().join("rollout-recency.sqlite"),
            &agent_root,
        )
        .unwrap(),
    );
    for (id, cwd, modified) in [
        ("recent", &recent, SystemTime::now()),
        ("stale", &stale, UNIX_EPOCH + Duration::from_secs(1)),
    ] {
        let thread = serde_json::from_value(json!({
            "sessionId":id,"threadId":id,"status":{"type":"idle"},
            "createdAtMs":1,"updatedAtMs":2,"archived":false,
            "metadata":{"workingDir":cwd},"name":id
        }))
        .unwrap();
        store
            .create_thread(CreateThreadParams { thread })
            .await
            .unwrap();
        let mut dirs = vec![agent_root.join("sessions")];
        let mut rollout = None;
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(dir).unwrap() {
                let entry = entry.unwrap();
                if entry.file_type().unwrap().is_dir() {
                    dirs.push(entry.path());
                } else if entry
                    .file_name()
                    .to_string_lossy()
                    .ends_with(&format!("-{id}.jsonl"))
                {
                    rollout = Some(entry.path());
                }
            }
        }
        File::options()
            .write(true)
            .open(rollout.expect("actual rollout file"))
            .unwrap()
            .set_times(FileTimes::new().set_modified(modified))
            .unwrap();
    }
    let desktop = desktop(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(fixture.config.clone())
            .with_projection_store(store),
    )
    .await;
    wait_queue(&fixture, false).await;
    enable(&desktop, true, 1).await;
    wait_queue(&fixture, false).await;
    assert!(
        recent.exists(),
        "Real rollout mtime must retain the recently active checkout"
    );
    assert!(
        !stale.exists(),
        "Path order must not replace real rollout activity"
    );
}

#[tokio::test]
async fn disabled_cleanup_survives_restart_and_reenable_consumes_the_saved_limit() {
    let fixture = Fixture::new().await;
    let old = fixture.create("a-old").await;
    let keep = fixture.create("z-keep").await;
    fixture.seed("old", &old, false, false, false).await;
    fixture.seed("keep", &keep, false, false, false).await;
    enable(&fixture.server, false, 1).await;
    let first = desktop(fixture.runtime.clone()).await;
    let first_queue = wait_queue(&fixture, false).await;
    assert_eq!(
        first_queue["bufferStartMs"], 0,
        "Disabled cleanup must not start the migration window"
    );
    assert!(old.exists() && keep.exists());
    drop(first);
    let cold = desktop(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(fixture.config.clone())
            .with_projection_store(Arc::new(
                ProjectionStore::initialize(fixture.store.path()).unwrap(),
            )),
    )
    .await;
    let cold_queue = wait_queue(&fixture, false).await;
    assert_eq!(cold_queue["bufferStartMs"], first_queue["bufferStartMs"]);
    assert!(old.exists() && keep.exists());
    enable(&cold, true, 1).await;
    let enabled_queue = wait_queue(&fixture, false).await;
    assert!(enabled_queue["bufferStartMs"].as_i64().unwrap() > 0);
    assert!(!old.exists() && keep.exists());
    assert_eq!(
        request(&cold, "config/read", json!({})).await["config"]["worktrees"]["keep-count"],
        1
    );
}

#[tokio::test]
async fn releasing_a_transport_subscription_requests_cleanup_without_another_config_edit() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    for unsubscribe in [true, false] {
        let fixture = Fixture::new().await;
        let attached = fixture.create("attached").await;
        let keep = fixture.create("keep").await;
        fixture.seed("keep", &keep, false, false, false).await;
        let (mut input, reader) = tokio::io::duplex(16 * 1024);
        let (writer, output) = tokio::io::duplex(16 * 1024);
        let runner = tokio::spawn(app_server::run_json_lines(
            AppServer::with_runtime(fixture.runtime.clone()),
            reader,
            writer,
        ));
        let mut lines = BufReader::new(output).lines();
        async fn rpc(
            input: &mut tokio::io::DuplexStream,
            lines: &mut tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
            id: u64,
            method: &str,
            params: Value,
        ) -> Value {
            input
                .write_all(
                    format!("{}\n", json!({"id":id,"method":method,"params":params})).as_bytes(),
                )
                .await
                .unwrap();
            loop {
                let line = tokio::time::timeout(Duration::from_secs(10), lines.next_line())
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap();
                let value: Value = serde_json::from_str(&line).unwrap();
                if value["id"] == id {
                    assert!(value.get("error").is_none(), "{value}");
                    return value["result"].clone();
                }
            }
        }
        rpc(
            &mut input,
            &mut lines,
            1,
            METHOD_INITIALIZE,
            json!({"clientInfo":{"name":"lime_desktop_electron","version":"1"}}),
        )
        .await;
        input
            .write_all(format!("{}\n", json!({"method":METHOD_INITIALIZED})).as_bytes())
            .await
            .unwrap();
        let started = rpc(
            &mut input,
            &mut lines,
            2,
            "thread/start",
            json!({"cwd":attached,"model":"fixture-model","modelProvider":"fixture-provider"}),
        )
        .await;
        wait_queue(&fixture, false).await;
        let enabled = rpc(&mut input, &mut lines, 3, METHOD_CONFIG_BATCH_WRITE,
            json!({"edits":[{"keyPath":"worktrees.keep-count","value":1,"mergeStrategy":"replace"}]})).await;
        assert!(enabled.is_object());
        wait_queue(&fixture, false).await;
        assert!(
            attached.exists() && keep.exists(),
            "Subscribed chat must protect its checkout"
        );
        if unsubscribe {
            let result = rpc(
                &mut input,
                &mut lines,
                4,
                "thread/unsubscribe",
                json!({"threadId":started["thread"]["id"]}),
            )
            .await;
            assert_eq!(result["status"], "unsubscribed");
            wait_queue(&fixture, false).await;
        }
        drop(input);
        tokio::time::timeout(Duration::from_secs(10), runner)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        while attached.exists() && keep.exists() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(
            usize::from(attached.exists()) + usize::from(keep.exists()),
            1,
            "Releasing the subscription must request cleanup (unsubscribe={unsubscribe})"
        );
    }
}

#[tokio::test]
async fn failed_automatic_snapshot_is_retained_and_pending_request_recovers_after_restart() {
    let fixture = Fixture::new().await;
    let old = fixture.create("a-old").await;
    let keep = fixture.create("z-keep").await;
    let other = fixture.create("b-other").await;
    fixture.seed("old", &old, false, false, false).await;
    fixture.seed("keep", &keep, false, false, false).await;
    fixture.seed("other", &other, false, false, false).await;
    let nested = old.join("nested");
    std::fs::create_dir(&nested).unwrap();
    git(&nested, &["init", "--template=", "--initial-branch=main"]);
    let first = desktop(fixture.runtime.clone()).await;
    wait_queue(&fixture, false).await;
    enable(&first, true, 1).await;
    wait_queue(&fixture, true).await;
    assert!(old.exists() && nested.join(".git").exists());
    assert!(
        !other.exists(),
        "One snapshot failure must not block other candidates"
    );
    assert!(!fixture.archived("old").await);
    drop(first);
    std::fs::remove_dir_all(&nested).unwrap();
    let cold = desktop(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(fixture.config.clone())
            .with_projection_store(Arc::new(
                ProjectionStore::initialize(fixture.store.path()).unwrap(),
            )),
    )
    .await;
    wait_queue(&fixture, false).await;
    assert!(!old.exists() && keep.exists());
    drop(cold);
}

#[tokio::test]
async fn manual_dirty_deletion_restores_nonignored_files_and_excludes_ignored_files() {
    let fixture = Fixture::new().await;
    std::fs::write(fixture.source.join(".gitignore"), "ignored\n").unwrap();
    git(&fixture.source, &["add", ".gitignore"]);
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
            "Ignore fixture",
        ],
    );
    let target = fixture.create("dirty").await;
    fixture.seed("dirty", &target, false, false, false).await;
    std::fs::write(target.join("local"), "save me").unwrap();
    std::fs::write(target.join("ignored"), "not saved").unwrap();
    request(
        &fixture.server,
        METHOD_PROJECT_GIT_WORKTREE_DELETE,
        json!({"rootPath":target}),
    )
    .await;
    assert!(!target.exists() && fixture.archived("dirty").await);
    request(
        &fixture.server,
        "thread/unarchive",
        json!({"threadId":"dirty"}),
    )
    .await;
    assert_eq!(
        std::fs::read_to_string(target.join("local")).unwrap(),
        "save me"
    );
    assert!(!target.join("ignored").exists());
}

#[tokio::test]
async fn confirmed_manual_delete_continues_without_snapshot_for_a_nested_repository() {
    let fixture = Fixture::new().await;
    let target = fixture.create("nested").await;
    fixture.seed("nested", &target, false, false, false).await;
    let nested = target.join("embedded");
    std::fs::create_dir(&nested).unwrap();
    git(&nested, &["init", "--template=", "--initial-branch=main"]);
    request(
        &fixture.server,
        METHOD_PROJECT_GIT_WORKTREE_DELETE,
        json!({"rootPath":target}),
    )
    .await;
    assert!(!target.exists() && fixture.archived("nested").await);
    let detail = fixture
        .store
        .read_thread(ReadThreadParams {
            thread_id: ThreadId::new("nested"),
            include_archived: true,
            turns_view: ThreadTurnsView::NotLoaded,
        })
        .await
        .unwrap()
        .unwrap();
    assert!(
        detail.metadata["worktreeSnapshot"].is_null(),
        "Unsaved contents must never advertise an older recovery snapshot"
    );
}
