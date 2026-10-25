use app_server::{AppServer, MockBackend, RuntimeCore};
use serde_json::{json, Value};
use std::sync::Arc;

async fn request(server: &AppServer, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        )
        .await
        .unwrap();
    lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|message| message["id"] == 1)
        .unwrap()
}

async fn initialize(server: &AppServer) {
    let response = request(
        server,
        "initialize",
        json!({"clientInfo":{"name":"local-environment-test","version":"1"}}),
    )
    .await;
    assert!(response.get("error").is_none(), "{response}");
    server
        .handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized","params":{}}).to_string())
        .await
        .unwrap();
}

#[tokio::test]
async fn public_config_round_trip_conflict_and_listing_never_run_scripts() {
    let temp = tempfile::tempdir().unwrap();
    let project = std::fs::canonicalize(temp.path()).unwrap();
    let config_path = project.join(".lime/environments/environment.toml");
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(project.join("config.yaml")),
    );
    let before = request(
        &server,
        "localEnvironments/readConfig",
        json!({"configPath":config_path}),
    )
    .await;
    assert!(before.get("error").is_some());
    initialize(&server).await;
    let empty = request(
        &server,
        "localEnvironments/readConfig",
        json!({"configPath":config_path}),
    )
    .await;
    assert_eq!(empty["result"]["exists"], false, "{empty}");
    assert!(!project.join(".lime").exists());
    let raw = "name = 'Project'\n[setup]\nscript = 'touch setup-ran'\n[cleanup]\nscript = 'touch cleanup-ran'\n[[actions]]\nname = 'Run'\ncommand = 'touch action-ran'\nicon = 'run'\n";
    let saved = request(
        &server,
        "localEnvironments/saveConfig",
        json!({"configPath":config_path,"raw":raw,"expectedRevision":null}),
    )
    .await;
    assert_eq!(saved["result"]["type"], "success", "{saved}");
    let revision = saved["result"]["revision"].as_str().unwrap();
    assert!(revision.starts_with("sha256:"));
    let loaded = request(
        &server,
        "localEnvironments/readConfig",
        json!({"configPath":config_path}),
    )
    .await;
    assert_eq!(loaded["result"]["revision"], revision);
    assert_eq!(loaded["result"]["raw"], raw);
    assert_eq!(loaded["result"]["environment"]["type"], "success");
    assert_eq!(
        loaded["result"]["environment"]["environment"]["name"],
        "Project"
    );
    let listed = request(
        &server,
        "localEnvironments/list",
        json!({"workspaceRoot":project}),
    )
    .await;
    assert_eq!(
        listed["result"]["environments"].as_array().unwrap().len(),
        1,
        "{listed}"
    );
    let conflicting = raw.replace("Project", "Conflicting");
    let conflict = request(
        &server,
        "localEnvironments/saveConfig",
        json!({"configPath":config_path,"raw":conflicting,"expectedRevision":"sha256:stale"}),
    )
    .await;
    assert_eq!(conflict["result"]["type"], "conflict", "{conflict}");
    assert_eq!(std::fs::read_to_string(&config_path).unwrap(), raw);
    for marker in ["setup-ran", "cleanup-ran", "action-ran"] {
        assert!(!project.join(marker).exists());
    }
    let restarted = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(project.join("config.yaml")),
    );
    initialize(&restarted).await;
    let persisted = request(
        &restarted,
        "localEnvironments/readConfig",
        json!({"configPath":config_path}),
    )
    .await;
    assert_eq!(persisted["result"]["revision"], revision);
}

#[tokio::test]
async fn public_invalid_params_and_remote_hosts_fail_closed() {
    let temp = tempfile::tempdir().unwrap();
    let project = std::fs::canonicalize(temp.path()).unwrap();
    let config_path = project.join(".lime/environments/environment.toml");
    let server = AppServer::with_runtime(RuntimeCore::with_backend(Arc::new(MockBackend)));
    initialize(&server).await;
    for (method, params) in [
        (
            "localEnvironments/list",
            json!({"workspaceRoot":project,"hostId":"remote"}),
        ),
        (
            "localEnvironments/list",
            json!({"workspaceRoot":"relative"}),
        ),
        (
            "localEnvironments/readConfig",
            json!({"configPath":config_path,"unrecognized":true}),
        ),
        (
            "localEnvironments/readConfig",
            json!({"configPath":project.join("config.yaml")}),
        ),
        (
            "localEnvironments/saveConfig",
            json!({"configPath":config_path,"raw":"invalid [","expectedRevision":null}),
        ),
    ] {
        let rejected = request(&server, method, params).await;
        assert_eq!(rejected["error"]["code"], -32602, "{method}: {rejected}");
    }
    assert!(!project.join(".lime").exists());
}

#[tokio::test]
async fn public_worktree_environment_switch_is_scoped_durable_and_never_executes_scripts() {
    let temp = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(temp.path()).unwrap();
    let source = root.join("source");
    std::fs::create_dir(&source).unwrap();
    let git = |cwd: &std::path::Path, args: &[&str]| {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", root.join("empty-gitconfig"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    };
    git(&source, &["init", "--template=", "--initial-branch=main"]);
    std::fs::write(source.join("README.md"), "test").unwrap();
    git(&source, &["add", "."]);
    git(
        &source,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "fixture",
        ],
    );
    let first = root.join("first");
    let second = root.join("second");
    for tree in [&first, &second] {
        git(
            &source,
            &[
                "worktree",
                "add",
                "--detach",
                tree.to_str().unwrap(),
                "HEAD",
            ],
        );
    }
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(root.join("config.yaml")),
    );
    let method = "projectGit/worktree/environment/set";
    let before = request(&server, method, json!({"rootPath":first,"configPath":null})).await;
    assert!(before.get("error").is_some(), "{before}");
    initialize(&server).await;
    let config = first.join(".lime/environments/environment.toml");
    let saved = request(&server, "localEnvironments/saveConfig", json!({
        "configPath":config, "raw":"name = 'Dev'\n[setup]\nscript = 'touch must-not-run'\n", "expectedRevision":null
    })).await;
    assert_eq!(saved["result"]["type"], "success", "{saved}");
    let nested = first.join("packages/app");
    std::fs::create_dir_all(&nested).unwrap();
    let selected = request(
        &server,
        method,
        json!({"rootPath":nested,"configPath":config}),
    )
    .await;
    assert_eq!(
        selected["result"]["localEnvironmentConfigPath"],
        config.to_str().unwrap(),
        "{selected}"
    );
    assert_eq!(selected["result"]["rootPath"], nested.to_str().unwrap());
    assert_eq!(selected["result"]["isWorktree"], true);
    let none = request(
        &server,
        method,
        json!({"rootPath":second,"configPath":null}),
    )
    .await;
    assert!(none.get("error").is_none(), "{none}");
    let worktree_config = git(&second, &["rev-parse", "--git-path", "config.worktree"]);
    assert_eq!(
        git(
            &second,
            &[
                "config",
                "--file",
                &worktree_config,
                "--get",
                "lime.localEnvironmentConfigPath"
            ]
        ),
        "__none__"
    );
    for params in [
        json!({"rootPath":source,"configPath":config}),
        json!({"rootPath":first,"configPath":first.join(".lime/environments/missing.toml")}),
        json!({"rootPath":first,"configPath":"relative"}),
        json!({"rootPath":first,"configPath":null,"scope":"local"}),
    ] {
        let rejected = request(&server, method, params).await;
        assert!(rejected.get("error").is_some(), "{rejected}");
    }
    let restarted = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(root.join("config.yaml")),
    );
    initialize(&restarted).await;
    for (tree, expected) in [(&first, json!(config)), (&second, Value::Null)] {
        let loaded = request(&restarted, "projectGit/status", json!({"rootPath":tree})).await;
        assert_eq!(
            loaded["result"]["localEnvironmentConfigPath"], expected,
            "{loaded}"
        );
        assert!(!tree.join("must-not-run").exists());
    }
    assert!(!source.join(".git/config.worktree").exists());
    let cleared = request(
        &restarted,
        method,
        json!({"rootPath":first,"configPath":null}),
    )
    .await;
    assert!(
        cleared["result"]["localEnvironmentConfigPath"].is_null(),
        "{cleared}"
    );
}
