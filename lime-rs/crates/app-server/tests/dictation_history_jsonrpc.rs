use app_server::{AppServer, LocalAppDataSource, MockBackend, RuntimeCore};
use app_server_protocol::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use lime_core::database::schema::create_tables;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tempfile::TempDir;

async fn server(root: &std::path::Path) -> AppServer {
    let conn = Connection::open_in_memory().unwrap();
    create_tables(&conn).unwrap();
    let source = LocalAppDataSource::initialize_with_roots(
        Arc::new(Mutex::new(conn)),
        root,
        root.join("agent"),
    )
    .await
    .unwrap();
    AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_data_source(Arc::new(source)),
    )
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(&json!({ "id": id, "method": method, "params": params }).to_string())
        .await
        .unwrap();
    assert_eq!(lines.len(), 1);
    let response: Value = serde_json::from_str(&lines[0]).unwrap();
    assert_eq!(response["id"], json!(id));
    response
}

async fn initialize(server: &AppServer) {
    let response = request(
        server,
        1,
        METHOD_INITIALIZE,
        json!({ "clientInfo": { "name": "dictation-history-test", "version": "1" } }),
    )
    .await;
    assert!(response.get("result").is_some(), "{response}");
    assert!(server
        .handle_json_line(&json!({ "method": METHOD_INITIALIZED }).to_string())
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn history_contract_requires_initialization_and_preserves_identity_through_restart_and_delete(
) {
    let temp = TempDir::new().unwrap();
    let app = server(temp.path()).await;
    let uninitialized = request(&app, 0, METHOD_DICTATION_HISTORY_LIST, json!({})).await;
    assert!(uninitialized.get("error").is_some());
    initialize(&app).await;
    let invalid = request(
        &app,
        2,
        METHOD_DICTATION_HISTORY_START,
        json!({ "mime_type": "audio/webm" }),
    )
    .await;
    assert_eq!(invalid["error"]["code"], json!(error_codes::INVALID_PARAMS));
    let start = request(
        &app,
        3,
        METHOD_DICTATION_HISTORY_START,
        json!({ "mimeType": "audio/webm" }),
    )
    .await;
    let id = start["result"]["recording"]["id"].as_str().unwrap();
    let audio = STANDARD.encode(b"dictation bytes");
    let appended = request(
        &app,
        4,
        METHOD_DICTATION_HISTORY_APPEND_AUDIO,
        json!({ "id": id, "offset": 0, "audioBase64": audio }),
    )
    .await;
    assert_eq!(appended["result"]["recording"]["sizeBytes"], json!(15));
    let denied = request(
        &app,
        5,
        METHOD_DICTATION_HISTORY_DELETE,
        json!({ "id": id }),
    )
    .await;
    assert!(denied.get("error").is_some());
    let finished = request(
        &app,
        6,
        METHOD_DICTATION_HISTORY_FINISH,
        json!({ "id": id, "status": "saved" }),
    )
    .await;
    assert_eq!(finished["result"]["recording"]["status"], "saved");
    let transcript = request(
        &app,
        7,
        METHOD_DICTATION_HISTORY_SET_TRANSCRIPT,
        json!({ "id": id, "text": "恢复的文本" }),
    )
    .await;
    assert_eq!(transcript["result"]["recording"]["id"], id);
    let id = id.to_string();
    drop(app);
    let app = server(temp.path()).await;
    initialize(&app).await;
    let list = request(&app, 8, METHOD_DICTATION_HISTORY_LIST, json!({})).await;
    assert_eq!(list["result"]["recordings"][0]["id"], id);
    assert_eq!(list["result"]["recordings"][0]["text"], "恢复的文本");
    let read = request(
        &app,
        9,
        METHOD_DICTATION_HISTORY_READ_AUDIO,
        json!({ "id": id }),
    )
    .await;
    assert_eq!(read["result"]["audioBase64"], audio);
    assert_eq!(read["result"]["mimeType"], "audio/webm");
    let deleted = request(
        &app,
        10,
        METHOD_DICTATION_HISTORY_DELETE,
        json!({ "id": id }),
    )
    .await;
    assert!(deleted.get("result").is_some(), "{deleted}");
    let late = request(
        &app,
        11,
        METHOD_DICTATION_HISTORY_SET_TRANSCRIPT,
        json!({ "id": id, "text": "late" }),
    )
    .await;
    assert!(late.get("error").is_some());
    let list = request(&app, 12, METHOD_DICTATION_HISTORY_LIST, json!({})).await;
    assert_eq!(list["result"]["recordings"], json!([]));
}
