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
    let config_path = project.join(".codex/environments/environment.toml");
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
    assert!(!project.join(".codex").exists());
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
    let config_path = project.join(".codex/environments/environment.toml");
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
    assert!(!project.join(".codex").exists());
}
