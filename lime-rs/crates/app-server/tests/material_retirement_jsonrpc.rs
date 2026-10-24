use app_server::{AppServer, MockBackend, RuntimeCore};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use serde_json::{json, Value};
use std::sync::Arc;
use tempfile::TempDir;

#[tokio::test]
async fn retired_project_material_methods_return_method_not_found_without_writes() {
    let temp = TempDir::new().expect("isolated config");
    let config_path = temp.path().join("config.yaml");
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_config_path(config_path.clone()),
    );
    let initialized = request(
        &server,
        1,
        METHOD_INITIALIZE,
        json!({
            "clientInfo": {"name": "material-retirement-test", "version": "1.0.0"}
        }),
    )
    .await;
    assert!(initialized.get("result").is_some(), "{initialized}");
    server
        .handle_json_line(
            &json!({
                "jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}
            })
            .to_string(),
        )
        .await
        .expect("initialized notification");

    for (index, method) in [
        "projectMaterial/list",
        "projectMaterial/get",
        "projectMaterial/count",
        "projectMaterial/upload",
        "projectMaterial/importFromUrl",
        "projectMaterial/update",
        "projectMaterial/delete",
        "projectMaterial/content",
    ]
    .into_iter()
    .enumerate()
    {
        let response = request(
            &server,
            index as u64 + 2,
            method,
            json!({
                "projectId": "retired-project",
                "id": "must-not-write",
                "name": "must-not-download",
                "url": "http://127.0.0.1:1/must-not-request",
                "content": "must not persist",
                "type": "image"
            }),
        )
        .await;
        assert_eq!(response["error"]["code"], -32601, "{method}: {response}");
        assert!(response.get("result").is_none(), "{method}: {response}");
    }
    assert!(
        !config_path.exists(),
        "rejected methods must not create config"
    );
    assert_eq!(
        std::fs::read_dir(temp.path()).expect("list temp").count(),
        0
    );
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({
                "jsonrpc": "2.0", "id": id, "method": method, "params": params
            })
            .to_string(),
        )
        .await
        .expect("public JSON-RPC request");
    lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).expect("JSON response"))
        .find(|message| message.get("id") == Some(&json!(id)))
        .unwrap_or_else(|| panic!("{method}: missing response {lines:?}"))
}
