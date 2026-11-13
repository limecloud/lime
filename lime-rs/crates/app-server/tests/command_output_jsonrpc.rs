use std::sync::Arc;

use agent_protocol::{
    ItemId, ItemStatus, SessionId, ThreadId, ThreadItem, ThreadItemPayload, TurnId,
};
use app_server::{
    ActionRespondRequest, AppServer, CancelExecutionRequest, EventLogWriter, ExecutionBackend,
    ExecutionRequest, ProjectionStore, RuntimeCore, RuntimeCoreError, RuntimeEvent,
    RuntimeEventSink,
};
use app_server_protocol::{
    METHOD_INITIALIZE, METHOD_INITIALIZED, METHOD_THREAD_READ, METHOD_THREAD_START,
    METHOD_TURN_START,
};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::sync::Semaphore;
use tokio::time::{timeout, Duration};

const DELTAS: [&str; 5] = [
    "\u{1b}[?1",
    "h\u{1b}=ready\r\n",
    " repeated \r\n",
    " repeated \r\n",
    "\t\r\n",
];

struct CommandOutputBackend {
    advance: Arc<Semaphore>,
}

#[async_trait::async_trait]
impl ExecutionBackend for CommandOutputBackend {
    async fn start_turn(
        &self,
        request: ExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        sink.emit(RuntimeEvent::new("turn.started", json!({})))?;
        let payload = ThreadItemPayload::Command {
            command: "stream output".to_owned(),
            cwd: None,
            output: None,
            exit_code: None,
        };
        let mut item = ThreadItem {
            session_id: SessionId::new(request.session.session_id),
            thread_id: ThreadId::new(request.session.thread_id),
            turn_id: TurnId::new(request.turn.turn_id),
            item_id: ItemId::new("raw-command"),
            sequence: 0,
            ordinal: 1,
            created_at_ms: 0,
            updated_at_ms: 0,
            completed_at_ms: None,
            kind: payload.kind(),
            status: ItemStatus::InProgress,
            payload,
            metadata: json!({
                "executionSurface": "unified_exec",
                "exec_command_call_id": "raw-command",
            }),
        };
        sink.emit(RuntimeEvent::new("item.started", json!({"item": item})))?;
        for delta in DELTAS {
            self.advance.acquire().await.unwrap().forget();
            sink.emit(RuntimeEvent::new(
                "tool.output.delta",
                json!({"tool_id": "raw-command", "delta": delta, "metadata": {"executionSurface": "unified_exec"}}),
            ))?;
            sink.emit(RuntimeEvent::new(
                "command.output",
                json!({"commandId": "raw-command", "delta": delta, "preview": delta.trim(), "outputRef": "output://raw-command"}),
            ))?;
        }
        self.advance.acquire().await.unwrap().forget();
        item.status = ItemStatus::Completed;
        if let ThreadItemPayload::Command {
            output, exit_code, ..
        } = &mut item.payload
        {
            *output = Some(DELTAS.concat());
            *exit_code = Some(0);
        }
        sink.emit(RuntimeEvent::new("item.completed", json!({"item": item})))?;
        sink.emit(RuntimeEvent::new("turn.completed", json!({})))
    }

    async fn cancel_turn(
        &self,
        _request: CancelExecutionRequest,
        _sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }
    async fn respond_action(
        &self,
        _request: ActionRespondRequest,
        _sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }
}

#[tokio::test]
async fn command_output_public_reads_keep_raw_deltas_through_completion_and_cold_recovery() {
    let temp = TempDir::new().unwrap();
    let advance = Arc::new(Semaphore::new(0));
    let runtime = || {
        RuntimeCore::with_backend(Arc::new(CommandOutputBackend {
            advance: advance.clone(),
        }))
        .with_projection_store(Arc::new(
            ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap(),
        ))
        .with_event_log_writer(Arc::new(
            EventLogWriter::new(temp.path().join("events")).unwrap(),
        ))
    };
    let server = AppServer::with_runtime(runtime());
    initialize(&server).await;
    let started = request(
        &server,
        2,
        METHOD_THREAD_START,
        json!({"model": "fixture-model", "modelProvider": "fixture-provider", "cwd": temp.path(), "historyMode": "paginated"}),
    )
    .await;
    let thread_id = started["result"]["thread"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let turn = request(
        &server,
        3,
        METHOD_TURN_START,
        json!({"threadId": thread_id, "input": [{"type": "text", "text": "stream output"}]}),
    )
    .await;
    let turn_id = turn["result"]["turn"]["id"].as_str().unwrap().to_owned();
    let mut raw = String::new();
    for delta in DELTAS {
        raw.push_str(delta);
        advance.add_permits(1);
        let read = wait_for_read(&server, &thread_id, &raw, "inProgress").await;
        assert_eq!(read["result"]["thread"]["turns"][0]["id"], turn_id);
    }
    advance.add_permits(1);
    let completed = wait_for_read(&server, &thread_id, &raw, "completed").await;
    let expected = completed["result"]["thread"]["turns"][0]["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["type"] == "commandExecution")
        .unwrap()
        .clone();
    assert_eq!(expected["aggregatedOutput"], raw);
    assert_eq!(expected["exitCode"], 0);
    drop(server);
    let restored = AppServer::with_runtime(runtime());
    initialize(&restored).await;
    let cold = request(
        &restored,
        4,
        METHOD_THREAD_READ,
        json!({"threadId": thread_id, "includeTurns": true}),
    )
    .await;
    let actual = cold["result"]["thread"]["turns"][0]["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["type"] == "commandExecution")
        .unwrap();
    assert_eq!(
        actual, &expected,
        "cold public read must preserve the complete canonical Command"
    );
}

async fn wait_for_read(server: &AppServer, thread_id: &str, expected: &str, status: &str) -> Value {
    let mut last = Value::Null;
    timeout(Duration::from_secs(5), async {
        loop {
            let read = request(server, 5, METHOD_THREAD_READ, json!({"threadId": thread_id, "includeTurns": true})).await;
            if read["result"]["thread"]["turns"].as_array().into_iter().flatten()
                .flat_map(|turn| turn["items"].as_array().into_iter().flatten())
                .any(|item| item["type"] == "commandExecution" && item["aggregatedOutput"] == expected && item["status"] == status) {
                return read;
            }
            last = read;
            tokio::task::yield_now().await;
        }
    }).await.unwrap_or_else(|_| panic!("Command output read timeout: thread={thread_id}, expected={expected:?}, status={status}, actual={last}"))
}

async fn initialize(server: &AppServer) {
    request(
        server,
        1,
        METHOD_INITIALIZE,
        json!({"clientInfo": {"name": "command-output-test", "version": "1"}}),
    )
    .await;
    server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}}).to_string(),
        )
        .await
        .unwrap();
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string(),
        )
        .await
        .unwrap();
    let response: Value = lines
        .iter()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|value| value["id"] == id)
        .unwrap();
    assert!(
        response.get("error").is_none(),
        "{method} failed: {response}"
    );
    response
}
