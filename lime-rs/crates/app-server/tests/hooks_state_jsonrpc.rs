//! Hook settings use the current config RPC and the same discovery source after restart.

use app_server::{AppServer, LocalAppDataSource, MockBackend, RuntimeCore};
use app_server_protocol::protocol::v2::{METHOD_CONFIG_BATCH_WRITE, METHOD_HOOKS_LIST};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use lime_core::database::schema::create_tables;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn hook_controls_round_trip_through_public_config_and_discovery() {
    let temp = tempfile::tempdir().unwrap();
    let Some(home) = std::env::var_os("LIME_HOOK_STATE_TEST_HOME") else {
        let home = temp.path().join("home");
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "hook_controls_round_trip_through_public_config_and_discovery",
                "--nocapture",
            ])
            .env("LIME_HOME", &home)
            .env("LIME_HOOK_STATE_TEST_HOME", &home)
            .output()
            .expect("run hook controls in an isolated process with injected home");
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    };
    let home = std::path::PathBuf::from(home);
    let cwd = temp.path().join("project");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(cwd.join(".lime")).unwrap();
    let hook_path = home.join("config.toml");
    std::fs::write(cwd.join(".lime/config.toml"), "[[hooks.PreToolUse]]\nmatcher = 'Bash'\n[[hooks.PreToolUse.hooks]]\ntype = 'command'\ncommand = 'echo reviewed'\n").unwrap();
    let yaml = temp.path().join("config.yaml");
    std::fs::write(&yaml, "language: ja-JP\n").unwrap();
    let original_yaml = std::fs::read(&yaml).unwrap();
    let connection = Connection::open_in_memory().unwrap();
    create_tables(&connection).unwrap();
    let source = Arc::new(
        LocalAppDataSource::initialize_with_roots(
            Arc::new(Mutex::new(connection)),
            &cwd,
            temp.path().join("data"),
        )
        .await
        .unwrap(),
    );
    let make_server = || {
        AppServer::with_runtime(
            RuntimeCore::with_backend(Arc::new(MockBackend))
                .with_app_config_path(yaml.clone())
                .with_app_data_source(source.clone()),
        )
    };
    let server = make_server();
    initialize(&server).await;
    let first = request(&server, 2, METHOD_HOOKS_LIST, json!({"cwds":[cwd]})).await;
    let hook = &first["result"]["data"][0]["hooks"][0];
    assert_eq!(hook["trustStatus"], "untrusted");
    let key = hook["key"].as_str().unwrap();
    let prefix = format!("hooks.state.{}", serde_json::to_string(key).unwrap());
    let saved = request(&server, 3, METHOD_CONFIG_BATCH_WRITE, json!({
        "edits":[{"keyPath":format!("{prefix}.trusted_hash"),"value":hook["currentHash"],"mergeStrategy":"upsert"}],
        "filePath":null,"expectedVersion":null,"reloadUserConfig":true
    })).await;
    assert_eq!(saved["result"]["status"], "ok", "{saved}");
    assert_eq!(
        saved["result"]["filePath"],
        hook_path.to_string_lossy().as_ref()
    );
    assert_eq!(std::fs::read(&yaml).unwrap(), original_yaml);
    drop(server);
    let server = make_server();
    initialize(&server).await;
    let trusted = request(&server, 4, METHOD_HOOKS_LIST, json!({"cwds":[cwd]})).await;
    assert_eq!(
        trusted["result"]["data"][0]["hooks"][0]["trustStatus"],
        "trusted"
    );
    let before = std::fs::read(&hook_path).unwrap();
    let mixed = request(
        &server,
        5,
        METHOD_CONFIG_BATCH_WRITE,
        json!({"edits":[
            {"keyPath":format!("{prefix}.enabled"),"value":false,"mergeStrategy":"upsert"},
            {"keyPath":"language","value":"en-US","mergeStrategy":"upsert"}
        ]}),
    )
    .await;
    assert!(mixed.get("error").is_some(), "{mixed}");
    assert_eq!(std::fs::read(&hook_path).unwrap(), before);
    assert_eq!(std::fs::read(&yaml).unwrap(), original_yaml);
    let disabled = request(&server, 6, METHOD_CONFIG_BATCH_WRITE, json!({
        "edits":[{"keyPath":format!("{prefix}.enabled"),"value":false,"mergeStrategy":"upsert"}],
        "expectedVersion": saved["result"]["version"]
    })).await;
    assert_eq!(disabled["result"]["status"], "ok", "{disabled}");
    let read = request(&server, 7, METHOD_HOOKS_LIST, json!({"cwds":[cwd]})).await;
    assert_eq!(read["result"]["data"][0]["hooks"][0]["enabled"], false);
}

async fn initialize(server: &AppServer) {
    let response = request(
        server,
        1,
        METHOD_INITIALIZE,
        json!({"clientInfo":{"name":"hook-controls-test","version":"1"}}),
    )
    .await;
    assert!(response.get("error").is_none(), "{response}");
    server
        .handle_json_line(&json!({"jsonrpc":"2.0","method":METHOD_INITIALIZED}).to_string())
        .await
        .unwrap();
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string(),
        )
        .await
        .unwrap()
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|value| value["id"] == id)
        .expect("matching RPC response")
}
