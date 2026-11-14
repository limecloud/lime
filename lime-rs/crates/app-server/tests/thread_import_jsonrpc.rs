use std::sync::Arc;

use app_server::{AppServer, MockBackend, ProjectionStore, RuntimeCore, StorageRoots};
use app_server_protocol::protocol::v2::METHOD_THREAD_IMPORT;
use app_server_protocol::{error_codes, METHOD_INITIALIZE, METHOD_INITIALIZED, METHOD_THREAD_READ};
use serde_json::{json, Value};
use tempfile::TempDir;
use thread_store::ThreadStore;

#[tokio::test]
async fn thread_import_creates_canonical_history_and_is_idempotent() {
    let temp = TempDir::new().expect("thread import temp dir");
    let roots = StorageRoots::initialize(temp.path(), temp.path().join("app-server"))
        .expect("thread import storage roots");
    let projection = Arc::new(
        ProjectionStore::initialize_with_storage_paths(
            &roots.projection_db_path,
            &roots.state_db_path,
            &roots.thread_history_db_path,
            &roots.data_root,
        )
        .expect("thread import projection store"),
    );
    let runtime =
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_projection_store(projection);
    let server = AppServer::with_runtime(runtime);
    initialize(&server).await;

    let request = json!({
        "source": "codex",
        "sourceConversationId": "conversation-fixture-1",
        "sourcePath": "/tmp/rollout-fixture-1.jsonl",
        "title": "导入测试会话",
        "cwd": "/repo/lime",
        "createdAtMs": 1_794_000_000_000i64,
        "updatedAtMs": 1_794_000_120_000i64,
        "turns": [
            {
                "sourceTurnId": "turn-a",
                "status": "completed",
                "startedAtMs": 1_794_000_000_000i64,
                "completedAtMs": 1_794_000_060_000i64,
                "messages": [
                    {
                        "role": "user",
                        "text": "帮我整理导入流程",
                        "createdAtMs": 1_794_000_001_000i64,
                        "sourceItemId": "msg-user-a"
                    },
                    {
                        "role": "assistant",
                        "text": "先列出会话，再逐个导入。",
                        "createdAtMs": 1_794_000_002_000i64,
                        "sourceItemId": "msg-assistant-a"
                    }
                ]
            },
            {
                "sourceTurnId": "turn-b",
                "status": "interrupted",
                "startedAtMs": 1_794_000_100_000i64,
                "completedAtMs": 1_794_000_120_000i64,
                "messages": [
                    {
                        "role": "user",
                        "text": "第二个问题",
                        "createdAtMs": 1_794_000_101_000i64
                    }
                ]
            }
        ]
    });
    let imported = request_raw(&server, 2, METHOD_THREAD_IMPORT, request.clone()).await;
    assert!(
        imported.get("error").is_none(),
        "thread/import failed: {imported}"
    );
    let result = imported.get("result").expect("thread/import result");
    assert_eq!(result["importedTurnCount"], json!(2));
    assert_eq!(result["importedMessageCount"], json!(3));
    assert_eq!(result["alreadyImported"], json!(false));
    let thread_id = result["threadId"].as_str().expect("imported thread id");
    assert_eq!(result["sessionId"], json!(thread_id));

    let read = request_raw(
        &server,
        3,
        METHOD_THREAD_READ,
        json!({"threadId": thread_id, "includeTurns": true}),
    )
    .await;
    let thread = &read["result"]["thread"];
    assert_eq!(thread["name"], json!("导入测试会话"));
    let turns = thread["turns"].as_array().expect("imported turns");
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0]["status"], json!("completed"));
    assert_eq!(turns[1]["status"], json!("interrupted"));

    // Retrying the same source identity must not create a second thread.
    let retried = request_raw(&server, 4, METHOD_THREAD_IMPORT, request).await;
    assert!(retried.get("error").is_none(), "retry failed: {retried}");
    assert_eq!(retried["result"]["threadId"], json!(thread_id));
    assert_eq!(retried["result"]["alreadyImported"], json!(true));
    assert_eq!(retried["result"]["importedTurnCount"], json!(2));
    assert_eq!(retried["result"]["importedMessageCount"], json!(3));

    // The imported history is durable across a fresh projection store/runtime.
    let reopened = Arc::new(
        ProjectionStore::initialize_with_storage_paths(
            &roots.projection_db_path,
            &roots.state_db_path,
            &roots.thread_history_db_path,
            &roots.data_root,
        )
        .expect("reopened thread import projection store"),
    );
    let persisted = reopened
        .read_thread(thread_store::ReadThreadParams {
            thread_id: agent_protocol::ThreadId::new(thread_id),
            include_archived: true,
            turns_view: agent_protocol::ThreadTurnsView::Full,
        })
        .await
        .expect("read reopened imported thread")
        .expect("imported thread persists");
    assert_eq!(persisted.turns.len(), 2);
    assert_eq!(persisted.turns[0].items.len(), 2);
}

#[tokio::test]
async fn thread_import_rejects_empty_or_invalid_history() {
    let temp = TempDir::new().expect("thread import invalid temp dir");
    let projection = ProjectionStore::initialize(temp.path().join("projection.sqlite"))
        .expect("thread import invalid projection store");
    let runtime = RuntimeCore::with_backend(Arc::new(MockBackend))
        .with_projection_store(Arc::new(projection));
    let server = AppServer::with_runtime(runtime);
    initialize(&server).await;

    let empty = request_raw(
        &server,
        2,
        METHOD_THREAD_IMPORT,
        json!({
            "source": "codex",
            "sourceConversationId": "empty",
            "title": "empty",
            "turns": []
        }),
    )
    .await;
    assert_eq!(
        empty.pointer("/error/code"),
        Some(&json!(error_codes::INVALID_REQUEST))
    );

    let empty_text = request_raw(
        &server,
        3,
        METHOD_THREAD_IMPORT,
        json!({
            "source": "codex",
            "sourceConversationId": "empty-text",
            "title": "empty text",
            "turns": [{
                "sourceTurnId": "turn-1",
                "status": "completed",
                "messages": [{
                    "role": "assistant",
                    "text": "  ",
                    "createdAtMs": 1
                }]
            }]
        }),
    )
    .await;
    assert_eq!(
        empty_text.pointer("/error/code"),
        Some(&json!(error_codes::INVALID_REQUEST))
    );
}

async fn initialize(server: &AppServer) {
    request_raw(
        server,
        1,
        METHOD_INITIALIZE,
        json!({"clientInfo": {"name": "thread-import-test", "version": "1"}}),
    )
    .await;
    server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}}).to_string(),
        )
        .await
        .expect("initialized notification");
}

async fn request_raw(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params
            })
            .to_string(),
        )
        .await
        .expect("handle JSON-RPC request");
    lines
        .into_iter()
        .map(|line| serde_json::from_str::<Value>(&line).expect("valid JSON-RPC response"))
        .find(|message| message.get("id") == Some(&json!(id)))
        .expect("matching JSON-RPC response")
}
