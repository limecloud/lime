use app_server::{AppServer, MockBackend, RuntimeCore};
use app_server_protocol::protocol::v2::{METHOD_CONFIG_BATCH_WRITE, METHOD_CONFIG_READ};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use serde_json::{json, Value};
use std::sync::Arc;

#[tokio::test]
async fn git_preferences_round_trip_and_invalid_batches_preserve_existing_config() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("config.yaml");
    std::fs::write(&config_path, "language: en-US\ntui:\n  animations: false\n").unwrap();
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_config_path(config_path.clone()),
    );
    initialize(&server).await;
    let initial = request(
        &server,
        2,
        METHOD_CONFIG_READ,
        json!({"includeLayers": true}),
    )
    .await;
    let git = json!({
        "branch-prefix": "", "always-force-push": true, "create-draft-pull-requests": false,
        "pull-request-merge-method": "squash", "review-delivery": "detached",
        "commit-instructions": "中文\nCommit guidance", "pull-request-instructions": "PR guidance"
    });
    let saved = request(
        &server,
        3,
        METHOD_CONFIG_BATCH_WRITE,
        json!({
            "expectedVersion": initial["result"]["layers"][0]["version"],
            "edits": [{"keyPath": "git", "value": git, "mergeStrategy": "replace"}]
        }),
    )
    .await;
    assert_eq!(saved["result"]["status"], "ok");
    let bytes = std::fs::read(&config_path).unwrap();
    for invalid in [
        json!({"branch-prefix": "a..b/"}),
        json!({"always-force-push": "true"}),
        json!({"review-delivery": "unknown"}),
        json!({"pull-request-merge-method": "rebase"}),
        json!({"commit-instructions": "x".repeat(32769)}),
        json!({"unknown": true}),
    ] {
        let rejected = raw_request(
            &server,
            4,
            METHOD_CONFIG_BATCH_WRITE,
            json!({"edits": [
                {"keyPath": "language", "value": "ja-JP", "mergeStrategy": "replace"},
                {"keyPath": "git", "value": invalid, "mergeStrategy": "replace"}
            ]}),
        )
        .await;
        assert!(rejected.get("error").is_some());
        assert_eq!(std::fs::read(&config_path).unwrap(), bytes);
    }
    drop(server);
    let restored = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_config_path(config_path),
    );
    initialize(&restored).await;
    let cold = request(&restored, 5, METHOD_CONFIG_READ, json!({})).await;
    assert_eq!(cold["result"]["config"]["git"], git);
    assert_eq!(cold["result"]["config"]["language"], "en-US");
    assert_eq!(cold["result"]["config"]["tui"]["animations"], false);
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
