use app_server::{AppServer, MockBackend, RuntimeCore};
use serde_json::{json, Value};
use std::sync::Arc;

fn server(path: &std::path::Path) -> AppServer {
    AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_instructions_path(path.into()),
    )
}

#[tokio::test]
async fn instructions_save_reload_conflict_and_override_use_public_jsonrpc() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("nested/AGENTS.md");
    let app = server(&path);
    assert!(request(&app, "instructions/read", json!({}))
        .await
        .get("error")
        .is_some());
    initialize(&app).await;
    let initial = request(&app, "instructions/read", json!({})).await;
    assert_eq!(initial["result"]["contents"], "");
    assert_eq!(initial["result"]["hasOverride"], false);
    let saved = request(
        &app,
        "instructions/write",
        json!({"contents": "请简明回复。\n", "expectedRevision": initial["result"]["revision"]}),
    )
    .await;
    assert!(saved.get("error").is_none(), "{saved}");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "请简明回复。\n");
    std::fs::write(&path, "external editor\n").unwrap();
    let conflict = request(
        &app,
        "instructions/write",
        json!({"contents": "stale", "expectedRevision": saved["result"]["revision"]}),
    )
    .await;
    assert!(conflict.get("error").is_some());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "external editor\n");
    std::fs::write(path.with_file_name("AGENTS.override.md"), "override").unwrap();
    let restored = server(&path);
    initialize(&restored).await;
    let read = request(&restored, "instructions/read", json!({})).await;
    assert_eq!(read["result"]["contents"], "external editor\n");
    assert_eq!(read["result"]["hasOverride"], true);
    let rejected = request(
        &restored,
        "instructions/write",
        json!({"contents": "界".repeat(11_000), "expectedRevision": read["result"]["revision"]}),
    )
    .await;
    assert!(rejected.get("error").is_some());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "external editor\n");
    std::fs::write(path.with_file_name("AGENTS.override.md"), "").unwrap();
    let read = request(&restored, "instructions/read", json!({})).await;
    assert_eq!(read["result"]["hasOverride"], false);
}

#[tokio::test]
async fn instructions_reject_non_utf8_and_distinguish_missing_from_empty() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("AGENTS.md");
    let app = server(&path);
    initialize(&app).await;
    let missing = request(&app, "instructions/read", json!({})).await;
    std::fs::write(&path, "").unwrap();
    let stale = request(
        &app,
        "instructions/write",
        json!({"contents": "new", "expectedRevision": missing["result"]["revision"]}),
    )
    .await;
    assert!(stale.get("error").is_some());
    std::fs::write(&path, [255, 254]).unwrap();
    let invalid = request(&app, "instructions/read", json!({})).await;
    assert!(invalid.get("error").is_some());
    assert_eq!(std::fs::read(&path).unwrap(), vec![255, 254]);
}

#[cfg(unix)]
#[tokio::test]
async fn saving_preserves_the_symlink_and_target_permissions() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("AGENTS.md");
    let target = temp.path().join("shared.md");
    std::fs::write(&target, "old").unwrap();
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
    symlink(&target, &path).unwrap();
    let app = server(&path);
    initialize(&app).await;
    let read = request(&app, "instructions/read", json!({})).await;
    let saved = request(
        &app,
        "instructions/write",
        json!({"contents": "new", "expectedRevision": read["result"]["revision"]}),
    )
    .await;
    assert!(saved.get("error").is_none(), "{saved}");
    assert!(std::fs::symlink_metadata(&path)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "new");
    assert_eq!(
        std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

async fn initialize(app: &AppServer) {
    let result = request(
        app,
        "initialize",
        json!({"clientInfo":{"name":"instructions-test","version":"1"}}),
    )
    .await;
    assert!(result.get("error").is_none(), "{result}");
    app.handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized","params":{}}).to_string())
        .await
        .unwrap();
}

async fn request(app: &AppServer, method: &str, params: Value) -> Value {
    let lines = app
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        )
        .await
        .unwrap();
    lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|value| value["id"] == 1)
        .unwrap()
}
