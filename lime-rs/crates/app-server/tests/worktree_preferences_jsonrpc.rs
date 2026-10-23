use app_server::{AppServer, MockBackend, RuntimeCore};
use app_server_protocol::protocol::v0::METHOD_PROJECT_GIT_WORKTREE_CREATE;
use app_server_protocol::protocol::v2::{METHOD_CONFIG_BATCH_WRITE, METHOD_CONFIG_READ};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;
use std::sync::Arc;

fn server(config: &Path) -> AppServer {
    AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_config_path(config.to_path_buf()),
    )
}

#[tokio::test]
async fn worktree_preferences_validate_atomically_and_restore_without_creating_directories() {
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("config.yaml");
    std::fs::write(&config, "language: en-US\ntui:\n  animations: false\n").unwrap();
    let server = server(&config);
    initialize(&server).await;
    let root = temp.path().join("Managed Worktrees");
    let preferences = json!({"root": root, "upstream-refresh-mode": "best-effort", "auto-cleanup-enabled": false, "keep-count": 7});
    save_preferences(&server, preferences.clone()).await;
    assert!(
        !root.exists(),
        "Saving preferences must not create directories"
    );
    let saved_bytes = std::fs::read(&config).unwrap();
    for invalid in [
        json!({"root": "relative/path"}),
        json!({"root": "~/worktrees"}),
        json!({"root": "/bad\npath"}),
        json!({"root": true}),
        json!({"upstream-refresh-mode": "always"}),
        json!({"auto-cleanup-enabled": "true"}),
        json!({"keep-count": 0}),
        json!({"keep-count": 1.5}),
        json!({"unknown": true}),
    ] {
        let result = raw_request(
            &server,
            METHOD_CONFIG_BATCH_WRITE,
            json!({"edits": [
                {"keyPath": "language", "value": "ja-JP", "mergeStrategy": "replace"},
                {"keyPath": "worktrees", "value": invalid, "mergeStrategy": "replace"}
            ]}),
        )
        .await;
        assert!(result.get("error").is_some(), "{result}");
        assert_eq!(std::fs::read(&config).unwrap(), saved_bytes);
    }
    drop(server);
    let cold = self::server(&config);
    initialize(&cold).await;
    let read = request(&cold, METHOD_CONFIG_READ, json!({})).await;
    assert_eq!(read["config"]["worktrees"], preferences);
    assert_eq!(read["config"]["language"], "en-US");
    assert_eq!(read["config"]["tui"]["animations"], false);
    assert!(!root.exists());
}

#[tokio::test]
async fn public_create_reads_the_latest_root_and_refresh_preference() {
    let temp = tempfile::tempdir().unwrap();
    let repository = temp.path().join("repo");
    std::fs::create_dir(&repository).unwrap();
    git(
        &repository,
        &["init", "--template=", "--initial-branch=main"],
    );
    git(
        &repository,
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
    let remote = temp.path().join("local-remote.git");
    git(
        temp.path(),
        &[
            "clone",
            "--bare",
            repository.to_str().unwrap(),
            remote.to_str().unwrap(),
        ],
    );
    git(
        &repository,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    let config = temp.path().join("config.yaml");
    std::fs::write(&config, "language: en-US\n").unwrap();
    let server = server(&config);
    initialize(&server).await;
    let custom = temp.path().join("Custom Worktrees");
    save_preferences(
        &server,
        json!({"root": custom, "upstream-refresh-mode": "never"}),
    )
    .await;
    assert!(!custom.exists());
    let created = request(
        &server,
        METHOD_PROJECT_GIT_WORKTREE_CREATE,
        json!({"rootPath": repository, "name": "first", "baseBranch": "main"}),
    )
    .await;
    assert_eq!(
        Path::new(created["worktreePath"].as_str().unwrap())
            .parent()
            .unwrap(),
        std::fs::canonicalize(&custom).unwrap()
    );
    assert!(
        git_output(&repository, &["for-each-ref", "refs/remotes/origin"]).is_empty(),
        "never must not fetch"
    );
    // 配置即时生效；本机 remote 不访问网络或真实仓库。
    save_preferences(
        &server,
        json!({"root": "", "upstream-refresh-mode": "best-effort"}),
    )
    .await;
    let created = request(
        &server,
        METHOD_PROJECT_GIT_WORKTREE_CREATE,
        json!({"rootPath": repository, "name": "second", "baseBranch": "main"}),
    )
    .await;
    assert_eq!(
        Path::new(created["worktreePath"].as_str().unwrap())
            .parent()
            .unwrap(),
        std::fs::canonicalize(temp.path().join("worktrees")).unwrap()
    );
    assert!(
        git_output(&repository, &["for-each-ref", "refs/remotes/origin/main"])
            .contains("refs/remotes/origin/main")
    );
    assert_eq!(
        git_output(&repository, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "main"
    );
    assert!(created["status"]["hasGitRepository"].as_bool().unwrap());
}

fn git_output(root: &Path, args: &[&str]) -> String {
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
    String::from_utf8(output.stdout).unwrap()
}

fn git(root: &Path, args: &[&str]) {
    git_output(root, args);
}

async fn save_preferences(server: &AppServer, preferences: Value) {
    let result = request(server, METHOD_CONFIG_BATCH_WRITE, json!({"edits": [{"keyPath": "worktrees", "value": preferences, "mergeStrategy": "replace"}]})).await;
    assert_eq!(result["status"], "ok");
}

async fn initialize(server: &AppServer) {
    request(
        server,
        METHOD_INITIALIZE,
        json!({"clientInfo": {"name": "worktree-settings-test", "version": "1"}}),
    )
    .await;
    server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}}).to_string(),
        )
        .await
        .unwrap();
}

async fn request(server: &AppServer, method: &str, params: Value) -> Value {
    let response = raw_request(server, method, params).await;
    assert!(response.get("error").is_none(), "{method}: {response}");
    response["result"].clone()
}

async fn raw_request(server: &AppServer, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).to_string(),
        )
        .await
        .unwrap();
    lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|line| line.get("id") == Some(&json!(1)))
        .expect("JSON-RPC response")
}
