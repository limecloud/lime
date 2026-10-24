#![cfg(not(target_os = "windows"))]

use agent_protocol::{Thread, ThreadId, ThreadTurnsView};
use app_server::{AppServer, MockBackend, ProjectionStore, RuntimeCore};
use lime_core::config::{Config, ConfigManager};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::Duration,
};
use thread_store::{CreateThreadParams, ReadThreadParams, ThreadStore};

struct Fixture {
    temp: tempfile::TempDir,
    source: PathBuf,
    workspace: PathBuf,
    environment: PathBuf,
    config: PathBuf,
    store: Arc<ProjectionStore>,
    server: AppServer,
}

impl Fixture {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(temp.path()).unwrap();
        let source = root.join("source");
        let workspace = source.join("packages/api");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::write(workspace.join("README.md"), "fixture").unwrap();
        git(&source, &["init", "--template=", "--initial-branch=main"]);
        git(&source, &["add", "."]);
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
                "-m",
                "Fixture",
            ],
        );
        let config = root.join("config.yaml");
        let config_value = Config {
            default_permissions: Some(":danger-full-access".into()),
            ..Config::default()
        };
        ConfigManager::with_config(config_value, config.clone())
            .save()
            .unwrap();
        let store = Arc::new(ProjectionStore::initialize(root.join("projection.sqlite")).unwrap());
        let environment = workspace.join(".codex/environments/environment.toml");
        let server = server(&config, store.clone()).await;
        Self {
            temp,
            source,
            workspace,
            environment,
            config,
            store,
            server,
        }
    }

    async fn save(&self, path: &Path, raw: &str) {
        let loaded = request(
            &self.server,
            10,
            "localEnvironments/readConfig",
            json!({"configPath":path}),
        )
        .await;
        let saved = request(
            &self.server,
            11,
            "localEnvironments/saveConfig",
            json!({"configPath":path,"raw":raw,"expectedRevision":loaded["result"]["revision"]}),
        )
        .await;
        assert_eq!(saved["result"]["type"], "success", "{saved}");
    }

    async fn create(&self, name: &str, extra: Value) -> Value {
        let mut params = json!({"rootPath":self.workspace,"name":name,"baseBranch":"main","localEnvironmentConfigPath":self.environment});
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        request(&self.server, 12, "projectGit/worktree/create", params).await
    }
}

async fn server(config: &Path, store: Arc<ProjectionStore>) -> AppServer {
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(config.to_path_buf())
            .with_projection_store(store),
    );
    let initialized = request(
        &server,
        1,
        "initialize",
        json!({"clientInfo":{"name":"local-environment-lifecycle-test","version":"1"}}),
    )
    .await;
    assert!(initialized.get("error").is_none(), "{initialized}");
    server
        .handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized"}).to_string())
        .await
        .unwrap();
    server
}

async fn request(server: &AppServer, id: i64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string(),
        )
        .await
        .unwrap();
    lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|message| message["id"] == id)
        .unwrap()
}

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{:?}: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().into()
}

fn quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

#[tokio::test]
async fn selected_setup_uses_platform_and_subdirectory_cleanup_survives_restart_and_failure_preserves_chat(
) {
    let fixture = Fixture::new().await;
    let common_config = std::fs::read(fixture.source.join(".git/config")).unwrap();
    let marker = std::fs::canonicalize(fixture.temp.path())
        .unwrap()
        .join("cleanup-done");
    let setup = "printf '%s\\n%s\\n' \"$CODEX_SOURCE_TREE_PATH\" \"$CODEX_WORKTREE_PATH\" > setup-paths.txt";
    let raw = format!("name='API'\n[setup]\nscript='exit 41'\n[setup.darwin]\nscript='''{setup}'''\n[setup.linux]\nscript='''{setup}'''\n[cleanup]\nscript='exit 23'\n");
    fixture.save(&fixture.environment, &raw).await;
    let created = fixture.create("selected", json!({})).await;
    assert_eq!(
        std::fs::read(fixture.source.join(".git/config")).unwrap(),
        common_config,
        "Selecting an environment must not modify source repository configuration"
    );
    assert!(created.get("error").is_none(), "{created}");
    let root = PathBuf::from(created["result"]["worktreePath"].as_str().unwrap());
    let workspace = root.join("packages/api");
    assert_eq!(
        created["result"]["setupResult"]["status"], "succeeded",
        "{created}"
    );
    assert_eq!(
        PathBuf::from(created["result"]["setupResult"]["cwd"].as_str().unwrap()),
        workspace
    );
    assert_eq!(
        std::fs::read_to_string(workspace.join("setup-paths.txt")).unwrap(),
        format!("{}\n{}\n", fixture.workspace.display(), workspace.display())
    );
    assert!(!fixture.workspace.join("setup-paths.txt").exists());
    let selected = PathBuf::from(git(
        &root,
        &[
            "config",
            "--file",
            &git(&root, &["rev-parse", "--git-path", "config.worktree"]),
            "--get",
            "codex.localEnvironmentConfigPath",
        ],
    ));
    assert_eq!(
        selected,
        workspace.join(".codex/environments/environment.toml")
    );
    let thread: Thread = serde_json::from_value(json!({"threadId":"cleanup-chat","sessionId":"cleanup-chat","status":{"type":"idle"},"createdAtMs":1,"updatedAtMs":2,"archived":false,"metadata":{"workingDir":workspace}})).unwrap();
    fixture
        .store
        .create_thread(CreateThreadParams { thread })
        .await
        .unwrap();
    let failed = request(
        &fixture.server,
        15,
        "projectGit/worktree/delete",
        json!({"rootPath":root}),
    )
    .await;
    assert!(
        failed["error"]["message"].as_str().unwrap().contains("23"),
        "{failed}"
    );
    assert!(root.exists());
    let thread = fixture
        .store
        .read_thread(ReadThreadParams {
            thread_id: ThreadId::new("cleanup-chat"),
            include_archived: true,
            turns_view: ThreadTurnsView::NotLoaded,
        })
        .await
        .unwrap()
        .unwrap();
    assert!(
        !thread.archived,
        "Failed cleanup must not archive the user's chat"
    );
    fixture
        .save(
            &selected,
            &format!(
                "name='API'\n[setup]\nscript=''\n[cleanup]\nscript='''printf done > {}'''\n",
                quote(&marker)
            ),
        )
        .await;
    let restarted = server(&fixture.config, fixture.store.clone()).await;
    let deleted = request(
        &restarted,
        16,
        "projectGit/worktree/delete",
        json!({"rootPath":root}),
    )
    .await;
    assert!(deleted.get("error").is_none(), "{deleted}");
    assert_eq!(std::fs::read_to_string(marker).unwrap(), "done");
    assert!(!root.exists());
}

#[tokio::test]
async fn setup_failure_has_recovery_path_allow_failure_and_explicit_none_skips_scripts() {
    let fixture = Fixture::new().await;
    fixture
        .save(
            &fixture.environment,
            "name='Fail'\n[setup]\nscript='exit 19'\n",
        )
        .await;
    let failed = fixture.create("failed", json!({})).await;
    assert_eq!(failed["error"]["code"], -32000, "{failed}");
    assert_eq!(failed["error"]["data"]["setupResult"]["status"], "failed");
    assert!(Path::new(failed["error"]["data"]["worktreePath"].as_str().unwrap()).is_dir());
    let allowed = fixture
        .create("allowed", json!({"allowSetupFailure":true}))
        .await;
    assert!(allowed.get("error").is_none(), "{allowed}");
    assert!(allowed["result"]["setupError"]
        .as_str()
        .unwrap()
        .contains("19"));
    let skipped = fixture
        .create("none", json!({"localEnvironmentConfigPath":"__none__"}))
        .await;
    assert!(skipped.get("error").is_none(), "{skipped}");
    assert!(skipped["result"].get("setupResult").is_none());
    let root = PathBuf::from(skipped["result"]["worktreePath"].as_str().unwrap());
    assert_eq!(
        git(
            &root,
            &[
                "config",
                "--file",
                &git(&root, &["rev-parse", "--git-path", "config.worktree"]),
                "--get",
                "codex.localEnvironmentConfigPath"
            ]
        ),
        "__none__"
    );
}

#[tokio::test]
async fn lifecycle_uses_current_permission_profile_before_spawning_script() {
    let fixture = Fixture::new().await;
    fixture
        .save(
            &fixture.environment,
            "name='Permission'\n[setup]\nscript='touch should-not-run'\n",
        )
        .await;
    let config = Config {
        default_permissions: Some("missing-lifecycle-profile".into()),
        ..Config::default()
    };
    ConfigManager::with_config(config, fixture.config.clone())
        .save()
        .unwrap();
    let failed = fixture.create("permission", json!({})).await;
    assert_eq!(failed["error"]["code"], -32000, "{failed}");
    assert!(
        failed["error"]["message"]
            .as_str()
            .unwrap()
            .contains("missing-lifecycle-profile"),
        "{failed}"
    );
    let root = PathBuf::from(failed["error"]["data"]["worktreePath"].as_str().unwrap());
    assert!(!root.join("packages/api/should-not-run").exists());
}

#[tokio::test]
async fn cancel_request_terminates_real_setup_and_preserves_recoverable_worktree() {
    let fixture = Fixture::new().await;
    let marker = std::fs::canonicalize(fixture.temp.path())
        .unwrap()
        .join("started");
    fixture.save(&fixture.environment,&format!("name='Cancel'\n[setup]\nscript='''printf started > {}\nwhile true; do sleep 1; done'''\n",quote(&marker))).await;
    let server = fixture.server.clone();
    let workspace = fixture.workspace.clone();
    let environment = fixture.environment.clone();
    let task = tokio::spawn(async move {
        request(&server,101,"projectGit/worktree/create",json!({"rootPath":workspace,"name":"cancelled","localEnvironmentConfigPath":environment})).await
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        while !marker.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    fixture
        .server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":101}}).to_string(),
        )
        .await
        .unwrap();
    let cancelled = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cancelled["error"]["code"], -32800, "{cancelled}");
    assert!(Path::new(cancelled["error"]["data"]["worktreePath"].as_str().unwrap()).is_dir());
    let listed = request(&fixture.server, 102, "projectGit/worktree/list", json!({})).await;
    assert_eq!(listed["result"]["worktrees"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn cancel_cleanup_keeps_checkout_and_releases_operation_for_retry() {
    let fixture = Fixture::new().await;
    let marker = std::fs::canonicalize(fixture.temp.path())
        .unwrap()
        .join("cleanup-started");
    fixture.save(&fixture.environment, &format!("name='Cancel cleanup'\n[setup]\nscript=''\n[cleanup]\nscript='''printf started > {}\nwhile true; do sleep 1; done'''\n", quote(&marker))).await;
    let created = fixture.create("cancel-cleanup", json!({})).await;
    assert!(created.get("error").is_none(), "{created}");
    let root = PathBuf::from(created["result"]["worktreePath"].as_str().unwrap());
    let selected = PathBuf::from(git(
        &root,
        &[
            "config",
            "--file",
            &git(&root, &["rev-parse", "--git-path", "config.worktree"]),
            "--get",
            "codex.localEnvironmentConfigPath",
        ],
    ));
    let server = fixture.server.clone();
    let target = root.clone();
    let task = tokio::spawn(async move {
        request(
            &server,
            201,
            "projectGit/worktree/delete",
            json!({"rootPath":target}),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        while !marker.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    fixture
        .server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":201}}).to_string(),
        )
        .await
        .unwrap();
    let cancelled = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cancelled["error"]["code"], -32800, "{cancelled}");
    assert!(root.is_dir());
    fixture
        .save(
            &selected,
            "name='Retry'\n[setup]\nscript=''\n[cleanup]\nscript=''\n",
        )
        .await;
    let retried = request(
        &fixture.server,
        202,
        "projectGit/worktree/delete",
        json!({"rootPath":root}),
    )
    .await;
    assert!(retried.get("error").is_none(), "{retried}");
    assert!(!root.exists());
}
