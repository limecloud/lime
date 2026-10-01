use std::sync::Arc;

use app_server::{AppServer, MockBackend, RuntimeCore};
use app_server_protocol::protocol::v2::{METHOD_PROMPT_HISTORY_APPEND, METHOD_PROMPT_HISTORY_READ};
use app_server_protocol::{error_codes, METHOD_INITIALIZE, METHOD_INITIALIZED};
use serde_json::{json, Value};

#[tokio::test]
async fn prompt_history_uses_thread_identity_and_survives_cold_public_read() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("prompt_history.jsonl");
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_prompt_history_path(&path),
    );
    initialize(&server).await;
    let text = "界 [$review](/one/SKILL.md)";
    let appended = request(
        &server,
        2,
        METHOD_PROMPT_HISTORY_APPEND,
        json!({"threadId": "thread-1", "text": text}),
    )
    .await;
    assert!(
        appended.get("error").is_none(),
        "append must pass v2 ingress: {appended:#}"
    );
    assert_eq!(appended["result"]["entry"]["threadId"], "thread-1");
    assert_eq!(appended["result"]["entry"]["text"], text);
    assert!(appended["result"]["entry"].get("sessionId").is_none());
    assert_eq!(appended["result"]["entryCount"], 1);
    let rejected = request(
        &server,
        3,
        METHOD_PROMPT_HISTORY_APPEND,
        json!({"sessionId": "thread-1", "text": "forbidden old wire"}),
    )
    .await;
    assert_eq!(rejected["error"]["code"], error_codes::INVALID_PARAMS);
    let empty = request(
        &server,
        4,
        METHOD_PROMPT_HISTORY_APPEND,
        json!({"threadId": " ", "text": "invalid identity"}),
    )
    .await;
    assert_eq!(empty["error"]["code"], error_codes::INVALID_PARAMS);
    let missing = request(
        &server,
        5,
        METHOD_PROMPT_HISTORY_APPEND,
        json!({"text": "missing identity"}),
    )
    .await;
    assert_eq!(missing["error"]["code"], error_codes::INVALID_PARAMS);
    let cold = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_prompt_history_path(&path),
    );
    initialize(&cold).await;
    let read = request(&cold, 6, METHOD_PROMPT_HISTORY_READ, json!({"limit": 10})).await;
    assert!(read.get("error").is_none(), "cold read: {read:#}");
    assert_eq!(read["result"]["entryCount"], 1);
    assert_eq!(
        read["result"]["data"],
        json!([appended["result"]["entry"].clone()])
    );
}

#[tokio::test]
async fn persistent_pages_bound_rows_keep_malformed_offsets_and_continue_through_empty_pages() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("prompt_history.jsonl");
    let rows = (0..350).map(|offset| {
        if offset == 0 || offset == 149 {
            json!({"session_id": "historic-thread", "ts": 1, "text": format!("needle {offset}")}).to_string()
        } else { "malformed".into() }
    }).collect::<Vec<_>>().join("\n") + "\n";
    std::fs::write(&path, rows).unwrap();
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_prompt_history_path(&path),
    );
    initialize(&server).await;
    let first = request(
        &server,
        2,
        METHOD_PROMPT_HISTORY_READ,
        json!({"limit": 100}),
    )
    .await;
    assert!(first.get("error").is_none(), "{first:#}");
    let log_id = first["result"]["logId"].as_str().unwrap();
    assert_eq!(first["result"]["entryCount"], 350);
    assert_eq!(first["result"]["data"], json!([]));
    assert_eq!(first["result"]["nextCursor"], "250");
    for (id, cursor, expected_next, offset) in [
        (3, "250", Some("150"), None),
        (4, "150", Some("50"), Some(149)),
        (5, "50", None, Some(0)),
    ] {
        let page = request(
            &server,
            id,
            METHOD_PROMPT_HISTORY_READ,
            json!({"limit": 100, "cursor": cursor, "logId": log_id}),
        )
        .await;
        assert!(page.get("error").is_none(), "page {cursor}: {page:#}");
        assert_eq!(page["result"]["nextCursor"], json!(expected_next));
        assert_eq!(
            page["result"]["data"].as_array().unwrap().len(),
            usize::from(offset.is_some())
        );
        if let Some(offset) = offset {
            assert_eq!(page["result"]["data"][0]["offset"], offset);
            assert_eq!(page["result"]["data"][0]["threadId"], "historic-thread");
        }
    }
    let stale = request(
        &server,
        6,
        METHOD_PROMPT_HISTORY_READ,
        json!({"cursor": "150", "limit": 100, "logId": "stale"}),
    )
    .await;
    assert_eq!(stale["result"]["data"], json!([]));
    assert_eq!(stale["result"]["nextCursor"], Value::Null);
    assert_eq!(stale["result"]["logId"], log_id);
}

async fn initialize(server: &AppServer) {
    let response = request(
        server,
        1,
        METHOD_INITIALIZE,
        json!({"clientInfo": {"name": "prompt-history-jsonrpc-test", "version": "1"}}),
    )
    .await;
    assert!(response.get("error").is_none(), "initialize: {response:#}");
    server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}}).to_string(),
        )
        .await
        .unwrap();
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string(),
        )
        .await
        .unwrap()
        .into_iter()
        .filter_map(|message| serde_json::from_str::<Value>(&message).ok())
        .find(|response| response["id"] == json!(id))
        .expect("JSON-RPC response")
}
