use agent_runtime::model_history::{HistoryReceipt, ModelHistoryRecord, MODEL_HISTORY_EVENT_TYPE};
use agent_runtime::session_loop::RuntimeSessionInputHandle;
use app_server::{
    ActionRespondRequest, AppServer, CancelExecutionRequest, EventLogWriter, ExecutionBackend,
    ExecutionRequest, ProjectionStore, ProviderTurnHistory, RuntimeCore, RuntimeCoreError,
    RuntimeEvent, RuntimeEventSink,
};
use async_trait::async_trait;
use model_provider::current_client::{
    CurrentProviderContent, CurrentProviderMessage, CurrentProviderToolCall,
    CurrentProviderToolResult,
};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[derive(Debug)]
struct Observation {
    turn_id: String,
    history: Vec<CurrentProviderMessage>,
    receipts: Vec<HistoryReceipt>,
}

struct HistoryBackend(mpsc::UnboundedSender<Observation>);

fn model_records() -> Vec<ModelHistoryRecord> {
    ["first", "second"]
        .into_iter()
        .flat_map(|id| {
            [
                ModelHistoryRecord::calls(&[CurrentProviderContent::ToolCall(
                    CurrentProviderToolCall::new(id, "Read", json!({"path":"same.txt"})),
                )])
                .unwrap(),
                ModelHistoryRecord::outputs(&[CurrentProviderContent::ToolResult(
                    CurrentProviderToolResult {
                        content_items: vec![agent_protocol::response_item::FunctionCallOutputContentItem::InputImage {
                            image_url: "data:image/png;base64,aGVsbG8=".into(), detail: None,
                        }],
                        call_id: id.to_string(),
                        name: "Read".to_string(),
                        success: true,
                        output: "equal output".to_string(),
                        error: None,
                        history_token_limit: Some(17),
                    },
                )]),
            ]
        })
        .collect()
}

#[async_trait]
impl ExecutionBackend for HistoryBackend {
    async fn start_turn(
        &self,
        _: ExecutionRequest,
        _: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        panic!("fixture requires the current session recorder boundary")
    }

    async fn start_turn_with_provider_history_and_session_input(
        &self,
        request: ExecutionRequest,
        history: ProviderTurnHistory,
        _: Option<RuntimeSessionInputHandle>,
        _: Option<CancellationToken>,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        sink.emit(RuntimeEvent::new("turn.started", json!({})))?;
        let mut receipts = Vec::new();
        if request.input.concat_text() == "record" {
            let recorder = sink.model_history_recorder().expect("session recorder");
            for record in model_records() {
                receipts.push(
                    recorder
                        .record(record)
                        .await
                        .map_err(RuntimeCoreError::Backend)?,
                );
            }
        }
        self.0
            .send(Observation {
                turn_id: request.turn.turn_id,
                history: history.messages_for_route("fixture", "model"),
                receipts,
            })
            .unwrap();
        sink.emit(RuntimeEvent::new("turn.completed", json!({})))
    }

    async fn cancel_turn(
        &self,
        _: CancelExecutionRequest,
        _: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    async fn respond_action(
        &self,
        _: ActionRespondRequest,
        _: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }
}

#[tokio::test]
async fn public_turn_receipts_identify_exact_durable_records_and_recover_without_rewriting() {
    let temp = tempfile::tempdir().unwrap();
    let writer = Arc::new(EventLogWriter::new(temp.path().join("events")).unwrap());
    let (sender, mut observations) = mpsc::unbounded_channel();
    let backend = Arc::new(HistoryBackend(sender));
    let runtime = || {
        RuntimeCore::with_backend(backend.clone())
            .with_event_log_writer(writer.clone())
            .with_projection_store(Arc::new(
                ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap(),
            ))
    };
    let server = AppServer::with_runtime(runtime());
    initialize(&server).await;
    let started = ok(
        &server,
        2,
        "thread/start",
        json!({
            "cwd":temp.path(),"modelProvider":"fixture","model":"model"
        }),
    )
    .await;
    let thread = started["result"]["thread"]["id"].as_str().unwrap();
    let session = started["result"]["thread"]["sessionId"].as_str().unwrap();
    turn(&server, 3, thread, "record").await;
    let recorded = tokio::time::timeout(Duration::from_secs(3), observations.recv())
        .await
        .unwrap()
        .unwrap();
    let before = writer.read_session_events(session).unwrap();
    let persisted = before
        .iter()
        .filter(|entry| entry.event.event_type == MODEL_HISTORY_EVENT_TYPE)
        .map(|entry| &entry.event)
        .collect::<Vec<_>>();
    assert_eq!(persisted.len(), 4);
    assert_eq!(recorded.receipts.len(), 4);
    for ((receipt, event), expected) in recorded.receipts.iter().zip(persisted).zip(model_records())
    {
        assert_eq!(receipt.event_id(), event.event_id);
        assert_eq!(receipt.sequence(), event.sequence);
        assert_eq!(event.session_id, session);
        assert_eq!(event.thread_id.as_deref(), Some(thread));
        assert_eq!(event.turn_id.as_deref(), Some(recorded.turn_id.as_str()));
        assert_eq!(
            serde_json::from_value::<ModelHistoryRecord>(event.payload.clone()).unwrap(),
            expected
        );
    }
    assert!(recorded
        .receipts
        .windows(2)
        .all(|pair| pair[0].sequence() < pair[1].sequence()
            && pair[0].event_id() != pair[1].event_id()));
    drop(server);

    let cold = AppServer::with_runtime(runtime());
    initialize(&cold).await;
    ok(&cold, 4, "thread/resume", json!({"threadId":thread})).await;
    assert_eq!(
        writer.read_session_events(session).unwrap(),
        before,
        "resume must not rewrite history"
    );
    turn(&cold, 5, thread, "inspect").await;
    let restored = tokio::time::timeout(Duration::from_secs(3), observations.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(restored.receipts.is_empty());
    let expected = std::iter::once(CurrentProviderMessage::user(vec![
        CurrentProviderContent::Text("record".to_string()),
    ]))
    .chain(
        model_records()
            .into_iter()
            .map(|record| record.into_message().unwrap()),
    )
    .collect::<Vec<_>>();
    assert_eq!(
        restored.history, expected,
        "cold provider history must preserve each model record and budget"
    );
}

#[tokio::test]
async fn ephemeral_public_thread_uses_shared_history_and_model_settings_without_persistence() {
    let temp = tempfile::tempdir().unwrap();
    let writer = Arc::new(EventLogWriter::new(temp.path().join("events")).unwrap());
    let (sender, mut observations) = mpsc::unbounded_channel();
    let backend = Arc::new(HistoryBackend(sender));
    let runtime = || {
        RuntimeCore::with_backend(backend.clone())
            .with_event_log_writer(writer.clone())
            .with_projection_store(Arc::new(
                ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap(),
            ))
    };
    let server = AppServer::with_runtime(runtime());
    initialize(&server).await;
    let started = ok(
        &server,
        2,
        "thread/start",
        json!({
            "cwd":temp.path(), "modelProvider":"fixture", "model":"model", "ephemeral":true
        }),
    )
    .await;
    let thread = started["result"]["thread"]["id"].as_str().unwrap();
    let session = started["result"]["thread"]["sessionId"].as_str().unwrap();
    assert_eq!(started["result"]["thread"]["ephemeral"], true);
    assert!(started["result"]["thread"]["path"].is_null());
    let loaded = ok(&server, 3, "thread/loaded/list", json!({})).await;
    assert!(loaded["result"]["data"]
        .as_array()
        .unwrap()
        .contains(&json!(thread)));
    let read = ok(&server, 4, "thread/read", json!({"threadId":thread})).await;
    assert_eq!(read["result"]["thread"]["ephemeral"], true);
    turn(&server, 5, thread, "record").await;
    let recorded = tokio::time::timeout(Duration::from_secs(3), observations.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(recorded.receipts.len(), 4);
    assert!(recorded
        .receipts
        .iter()
        .all(|receipt| !receipt.is_durable()));
    assert!(writer.read_session_events(session).unwrap().is_empty());
    ok(
        &server,
        6,
        "thread/settings/update",
        json!({"threadId":thread, "model":"other-model"}),
    )
    .await;
    let settings = ok(&server, 7, "thread/read", json!({"threadId":thread})).await;
    assert_eq!(
        settings["result"]["thread"]["extra"]["modelName"],
        "other-model"
    );
    turn(&server, 8, thread, "inspect").await;
    let restored = tokio::time::timeout(Duration::from_secs(3), observations.recv())
        .await
        .unwrap()
        .unwrap();
    for expected in model_records()
        .into_iter()
        .map(|record| record.into_message().unwrap())
    {
        assert!(
            restored.history.contains(&expected),
            "missing in-memory history: {restored:?}"
        );
    }
    assert!(writer.read_session_events(session).unwrap().is_empty());
    for (id, method, params) in [
        (
            9,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        ),
        (10, "thread/turns/list", json!({"threadId":thread})),
        (11, "thread/items/list", json!({"threadId":thread})),
    ] {
        let lines = server
            .handle_json_line(
                &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string(),
            )
            .await
            .unwrap();
        let response = lines
            .iter()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .find(|value| value["id"] == id)
            .unwrap();
        assert!(
            response["error"]["message"]
                .as_str()
                .unwrap()
                .contains("ephemeral"),
            "{response}"
        );
    }
    let cold = AppServer::with_runtime(runtime());
    initialize(&cold).await;
    let listed = ok(&cold, 12, "thread/list", json!({})).await;
    assert!(listed["result"]["data"].as_array().unwrap().is_empty());
    let resumed = cold
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":13,"method":"thread/resume","params":{"threadId":thread}})
                .to_string(),
        )
        .await
        .unwrap();
    assert!(resumed
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .any(|value| value["id"] == 13 && value.get("error").is_some()));
}

async fn turn(server: &AppServer, id: u64, thread: &str, text: &str) {
    let mut outbound = server.subscribe_outbound_messages();
    let response = ok(
        server,
        id,
        "turn/start",
        json!({
            "threadId":thread,"input":[{"type":"text","text":text}]
        }),
    )
    .await;
    let turn = response["result"]["turn"]["id"].as_str().unwrap();
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let event = serde_json::to_value(outbound.recv().await.expect("terminal notification"))
                .unwrap();
            if event["method"] == "turn/completed" && event["params"]["turn"]["id"] == turn {
                assert_eq!(event["params"]["turn"]["status"], "completed", "{event}");
                break;
            }
        }
    })
    .await
    .expect("same Turn terminal");
}

async fn initialize(server: &AppServer) {
    ok(
        server,
        1,
        "initialize",
        json!({"clientInfo":{"name":"history-receipt-test","version":"1"}}),
    )
    .await;
    server
        .handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized","params":{}}).to_string())
        .await
        .unwrap();
}

async fn ok(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string(),
        )
        .await
        .unwrap();
    let response = lines
        .iter()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|value| value["id"] == id)
        .unwrap_or_else(|| panic!("missing {method}: {lines:?}"));
    assert!(response.get("error").is_none(), "{method}: {response}");
    response
}
