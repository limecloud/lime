use app_server::{AppServer, MockBackend, RuntimeCore};
use app_server_protocol::protocol::v2::{METHOD_CONFIG_BATCH_WRITE, METHOD_CONFIG_READ};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use lime_core::config::ConfigManager;
use serde_json::{json, Value};
use std::sync::Arc;
use tempfile::TempDir;

#[tokio::test]
async fn keyboard_shortcuts_persist_and_invalid_batches_preserve_the_file() {
    let temp = TempDir::new().unwrap();
    let config_path = temp.path().join("config.yaml");
    std::fs::write(&config_path, "language: en-US\ntui:\n  animations: false\n").unwrap();
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_config_path(config_path.clone()),
    );
    initialize(&server).await;
    let read = request(
        &server,
        2,
        METHOD_CONFIG_READ,
        json!({"includeLayers": true}),
    )
    .await;
    let desktop = json!({"keyboard-shortcuts": {"searchSettings": ["Control+J", "Alt+F2"], "showKeyboardShortcuts": []}, "open-local-url-in-target-preference": "external-browser"});
    let saved = request(
        &server,
        3,
        METHOD_CONFIG_BATCH_WRITE,
        json!({
            "expectedVersion": read["result"]["layers"][0]["version"],
            "edits": [{"keyPath": "desktop", "value": desktop, "mergeStrategy": "replace"}]
        }),
    )
    .await;
    assert_eq!(saved["result"]["status"], "ok");
    let config = ConfigManager::load(&config_path).unwrap();
    assert_eq!(
        config.config().desktop.keyboard_shortcuts["searchSettings"],
        vec!["Control+J", "Alt+F2"]
    );
    assert_eq!(
        config.config().desktop.keyboard_shortcuts["showKeyboardShortcuts"],
        Vec::<String>::new()
    );
    let bytes = std::fs::read(&config_path).unwrap();
    for invalid in [
        json!({"searchSettings": ["Hyper+J"]}),
        json!({"searchSettings": null}),
        json!({"searchSettings": ["Control+J Control+S"]}),
    ] {
        let rejected = raw_request(&server, 4, METHOD_CONFIG_BATCH_WRITE, json!({"edits": [
            {"keyPath": "language", "value": "ja-JP", "mergeStrategy": "replace"},
            {"keyPath": "desktop.keyboard-shortcuts", "value": invalid, "mergeStrategy": "replace"}
        ]})).await;
        assert!(rejected.get("error").is_some());
        assert_eq!(std::fs::read(&config_path).unwrap(), bytes);
    }
    drop(server);
    let restored = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_config_path(config_path),
    );
    initialize(&restored).await;
    let read = request(&restored, 5, METHOD_CONFIG_READ, json!({})).await;
    assert_eq!(
        read["result"]["config"]["desktop"]["keyboard-shortcuts"],
        desktop["keyboard-shortcuts"]
    );
    assert_eq!(read["result"]["config"]["tui"]["animations"], false);
    assert_eq!(read["result"]["config"]["language"], "en-US");
    let reset = request(
        &restored,
        6,
        METHOD_CONFIG_BATCH_WRITE,
        json!({"edits": [
            {"keyPath": "desktop.keyboard-shortcuts", "value": {}, "mergeStrategy": "replace"}
        ]}),
    )
    .await;
    assert_eq!(reset["result"]["status"], "ok");
    let read = request(&restored, 7, METHOD_CONFIG_READ, json!({})).await;
    assert!(read["result"]["config"]["desktop"]
        .get("keyboard-shortcuts")
        .is_none());
    assert_eq!(
        read["result"]["config"]["desktop"]["open-local-url-in-target-preference"],
        "external-browser"
    );
}

async fn initialize(server: &AppServer) {
    request(
        server,
        1,
        METHOD_INITIALIZE,
        json!({"clientInfo": {"name": "keyboard-settings-test", "version": "1"}}),
    )
    .await;
    assert!(server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}}).to_string()
        )
        .await
        .unwrap()
        .is_empty());
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let response = raw_request(server, id, method, params).await;
    assert!(response.get("error").is_none(), "{method}: {response}");
    response
}

async fn raw_request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string(),
        )
        .await
        .unwrap();
    lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|value| value["id"] == id)
        .unwrap()
}
