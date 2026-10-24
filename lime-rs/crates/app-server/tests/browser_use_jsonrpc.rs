//! Public browser admission and Desktop approval configuration contract.

use app_server::{AppServer, RuntimeCore};
use app_server_protocol::BrowserUseConfig;
use serde_json::{json, Value};

async fn call(server: &AppServer, method: &str, params: Value) -> Value {
    let messages = server
        .handle_json_line(
            &json!({
                "jsonrpc":"2.0", "id":1, "method":method, "params":params
            })
            .to_string(),
        )
        .await
        .unwrap();
    messages
        .into_iter()
        .find_map(|line| {
            let value: Value = serde_json::from_str(&line).unwrap();
            (value["id"] == 1).then_some(value)
        })
        .unwrap()
}

async fn initialize(server: &AppServer) {
    let response = call(
        server,
        "initialize",
        json!({"clientInfo":{"name":"browser-use-config-fixture","version":"1"}}),
    )
    .await;
    assert!(response.get("error").is_none(), "{response}");
    server
        .handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized"}).to_string())
        .await
        .unwrap();
}

#[tokio::test]
async fn browser_use_and_native_preferences_are_atomic_and_survive_restart() {
    let temp = tempfile::TempDir::new().unwrap();
    let path = temp.path().join("config.yaml");
    std::fs::write(&path, "server:\n  api_key: test-only\n").unwrap();
    let make_server =
        || AppServer::with_runtime(RuntimeCore::default().with_app_config_path(path.clone()));
    let server = make_server();
    initialize(&server).await;
    let read = call(&server, "config/read", json!({"includeLayers":true})).await;
    let initial_version = read["result"]["layers"][0]["version"].clone();
    let policy = json!({
        "allow_history_access":false,
        "default_origin_policy":{"access":"deny","downloads":"allow"},
        "origins":{"https://example.com":{"access":"allow","uploads":"deny"}}
    });
    let write = call(&server, "config/batchWrite", json!({
        "expectedVersion":initial_version,
        "edits":[
            {"keyPath":"browser_use","value":policy,"mergeStrategy":"replace"},
            {"keyPath":"browser","value":{"approvalMode":"alwaysAsk","iabHistoryApprovalMode":"neverAsk","allowedOrigins":["https://example.com"]},"mergeStrategy":"replace"}
        ]
    })).await;
    assert_eq!(write["result"]["status"], "ok", "{write}");
    let bytes = std::fs::read(&path).unwrap();
    for invalid in [
        json!({"origins":{"https://example.com":{"access":"ask"}}}),
        json!({"default_origin_policy":{"download":"allow"}}),
        json!({"origins":{"https://example.com/private":{"access":"allow"}}}),
    ] {
        let rejected = call(
            &server,
            "config/batchWrite",
            json!({
                "expectedVersion":write["result"]["version"],
                "edits":[
                    {"keyPath":"browser.approvalMode","value":"neverAsk","mergeStrategy":"replace"},
                    {"keyPath":"browser_use","value":invalid,"mergeStrategy":"replace"}
                ]
            }),
        )
        .await;
        assert!(rejected.get("error").is_some(), "{rejected}");
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
    let stale = call(&server, "config/value/write", json!({
        "expectedVersion":initial_version,"keyPath":"browser.approvalMode","value":"neverAsk","mergeStrategy":"replace"
    })).await;
    assert_eq!(
        stale["error"]["data"]["config_write_error_code"],
        "configVersionConflict"
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    drop(server);

    let server = make_server();
    initialize(&server).await;
    let read = call(&server, "config/read", json!({})).await;
    let config = &read["result"]["config"];
    let parsed: BrowserUseConfig = serde_json::from_value(config["browser_use"].clone()).unwrap();
    assert_eq!(parsed.allow_history_access, Some(false));
    assert_eq!(config["browser"]["iabHistoryApprovalMode"], "neverAsk");
    assert_eq!(config["browser"]["approvalMode"], "alwaysAsk");
    assert!(config["browser"].get("agent_permissions").is_none());
    assert!(config["browser"].get("history_access").is_none());
    let enabled = call(
        &server,
        "config/value/write",
        json!({
            "keyPath":"browser_use.allow_history_access","value":true,"mergeStrategy":"replace"
        }),
    )
    .await;
    assert_eq!(enabled["result"]["status"], "ok");
    let read = call(&server, "config/read", json!({})).await;
    assert_eq!(
        read["result"]["config"]["browser"]["iabHistoryApprovalMode"],
        "neverAsk"
    );
}
