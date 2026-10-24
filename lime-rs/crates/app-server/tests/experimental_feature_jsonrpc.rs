use app_server::{AppServer, MockBackend, RuntimeCore};
use app_server_protocol::protocol::v2::{
    METHOD_EXPERIMENTAL_FEATURE_ENABLEMENT_SET, METHOD_EXPERIMENTAL_FEATURE_LIST,
};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED, PROTOCOL_VERSION};
use lime_core::config::ConfigManager;
use serde_json::{json, Value};
use std::sync::Arc;
use tempfile::TempDir;

#[tokio::test]
async fn feature_catalog_uses_canonical_config_and_rejects_retired_flags() {
    let temp = TempDir::new().expect("feature config temp");
    let config_path = temp.path().join("config.yaml");
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_config_path(config_path.clone()),
    );
    let uninitialized =
        request_error(&server, 0, METHOD_EXPERIMENTAL_FEATURE_LIST, json!({})).await;
    assert!(uninitialized.get("error").is_some());
    initialize(&server).await;

    let listed = request(&server, 2, METHOD_EXPERIMENTAL_FEATURE_LIST, json!({})).await;
    let feature = &listed["result"]["data"][0];
    assert_eq!(feature["name"], "workspace_dependencies");
    assert_eq!(feature["enabled"], true);
    assert_eq!(feature["defaultEnabled"], true);
    assert_eq!(feature["stage"], "stable");

    for (id, name) in [(3, "webmcp"), (4, "unknown")] {
        let rejected = request_error(
            &server,
            id,
            METHOD_EXPERIMENTAL_FEATURE_ENABLEMENT_SET,
            json!({"enablement": {name: false}}),
        )
        .await;
        assert_eq!(rejected["error"]["code"], -32602);
        assert!(
            !config_path.exists(),
            "rejected writes must not create a config"
        );
    }
    let updated = request(
        &server,
        5,
        METHOD_EXPERIMENTAL_FEATURE_ENABLEMENT_SET,
        json!({"enablement": {"workspace_dependencies": false}}),
    )
    .await;
    assert_eq!(
        updated["result"]["enablement"],
        json!({"workspace_dependencies": false})
    );
    let listed = request(
        &server,
        6,
        METHOD_EXPERIMENTAL_FEATURE_LIST,
        json!({"cursor": "0", "limit": 1}),
    )
    .await;
    assert_eq!(listed["result"]["data"][0]["enabled"], false);
    assert_eq!(listed["result"]["nextCursor"], Value::Null);
    let persisted = ConfigManager::load(&config_path).expect("load persisted config");
    assert!(!persisted.config().features.workspace_dependencies_enabled());

    let cold = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_config_path(config_path),
    );
    initialize(&cold).await;
    let listed = request(&cold, 7, METHOD_EXPERIMENTAL_FEATURE_LIST, json!({})).await;
    assert_eq!(listed["result"]["data"][0]["enabled"], false);
    let unknown_thread = request_error(
        &server,
        8,
        METHOD_EXPERIMENTAL_FEATURE_LIST,
        json!({"threadId": "missing-thread"}),
    )
    .await;
    assert_eq!(unknown_thread["error"]["code"], -32600);
    assert_eq!(
        unknown_thread["error"]["message"],
        "thread not found: missing-thread"
    );
}

async fn initialize(server: &AppServer) {
    let response = request(
        server,
        1,
        METHOD_INITIALIZE,
        json!({
            "clientInfo": {"name": "experimental-feature-jsonrpc-test", "version": "1.0.0"}
        }),
    )
    .await;
    assert_eq!(
        response["result"]["serverInfo"]["protocolVersion"],
        PROTOCOL_VERSION
    );
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}}).to_string(),
        )
        .await
        .expect("initialized notification");
    assert!(lines.is_empty());
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string(),
        )
        .await
        .expect("handle JSON-RPC request");
    let response = lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).expect("decode response"))
        .find(|message| message.get("id") == Some(&json!(id)))
        .unwrap_or_else(|| panic!("{method} should return matching response: {lines:#?}"));
    if let Some(error) = response.get("error") {
        panic!("{method} failed: {error}");
    }
    response
}

async fn request_error(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string(),
        )
        .await
        .expect("handle JSON-RPC request");
    lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).expect("decode response"))
        .find(|message| message.get("id") == Some(&json!(id)))
        .unwrap_or_else(|| panic!("{method} should return matching response: {lines:#?}"))
}
