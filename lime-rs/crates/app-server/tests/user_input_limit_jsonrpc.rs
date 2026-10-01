//! Shared GUI/CLI/TUI ingress: Unicode size errors precede runtime or queue mutation.

use std::sync::Arc;

use agent_protocol::input::MAX_USER_INPUT_TEXT_CHARS;
use app_server::{
    ActionRespondRequest, AppServer, CancelExecutionRequest, ExecutionBackend, ExecutionRequest,
    ProjectionStore, RuntimeCore, RuntimeCoreError, RuntimeEvent, RuntimeEventSink,
};
use app_server_protocol::error_codes;
use app_server_protocol::protocol::v2::UserInput;
use async_trait::async_trait;
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::sync::{mpsc, Notify};
use tokio::time::{timeout, Duration};

struct CaptureBackend {
    requests: mpsc::UnboundedSender<ExecutionRequest>,
    release: Notify,
    completed: Notify,
}

#[async_trait]
impl ExecutionBackend for CaptureBackend {
    async fn start_turn(
        &self,
        request: ExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        sink.emit(RuntimeEvent::new("turn.started", json!({})))?;
        self.requests.send(request).expect("capture turn request");
        self.release.notified().await;
        let result = sink.emit(RuntimeEvent::new("turn.completed", json!({})));
        self.completed.notify_one();
        result
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
async fn public_turn_and_queue_ingress_share_aggregate_unicode_limit_and_reject_without_mutation() {
    let temp = TempDir::new().expect("input limit isolated app data");
    let agent_root = temp.path().join("agent");
    let store = Arc::new(
        ProjectionStore::initialize_with_agent_root(
            agent_root.join("projection.sqlite"),
            &agent_root,
        )
        .expect("input limit projection store"),
    );
    let (tx, mut captured) = mpsc::unbounded_channel();
    let backend = Arc::new(CaptureBackend {
        requests: tx,
        release: Notify::new(),
        completed: Notify::new(),
    });
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(backend.clone()).with_projection_store(store),
    );
    let initialized = request(
        &server,
        1,
        "initialize",
        json!({
            "clientInfo": {"name": "user-input-limit-test", "version": "1"},
            "capabilities": {"experimentalApi": true}
        }),
    )
    .await;
    assert!(
        initialized.get("result").is_some(),
        "initialize: {initialized}"
    );
    server
        .handle_json_line(&json!({"jsonrpc":"2.0", "method":"initialized"}).to_string())
        .await
        .expect("initialized notification");
    let started = request(
        &server,
        2,
        "thread/start",
        json!({
            "model":"fixture-model", "modelProvider":"fixture-provider"
        }),
    )
    .await;
    let thread_id = started
        .pointer("/result/thread/id")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("canonical thread/start: {started}"));
    let original = request(&server, 20, "thread/read", json!({"threadId":thread_id})).await;

    let oversized = json!([
        {"type":"text", "text":"界".repeat(MAX_USER_INPUT_TEXT_CHARS / 2)},
        {"type":"text", "text":"🙂".repeat(MAX_USER_INPUT_TEXT_CHARS / 2 + 1)},
        {"type":"mention", "name":"docs", "path":"app://docs"}
    ]);
    let expected_error = json!({
        "code": error_codes::INVALID_PARAMS,
        "message": format!("Input exceeds the maximum length of {MAX_USER_INPUT_TEXT_CHARS} characters."),
        "data": {
            "input_error_code":"input_too_large",
            "max_chars":MAX_USER_INPUT_TEXT_CHARS,
            "actual_chars":MAX_USER_INPUT_TEXT_CHARS + 1
        }
    });
    for (id, method, extra) in [
        (3, "turn/start", json!({"model":"must-not-be-applied"})),
        (4, "turn/steer", json!({"expectedTurnId":"not-active"})),
        (
            5,
            "thread/queue/add",
            json!({"clientUserMessageId":"rejected"}),
        ),
        (
            6,
            "thread/queue/update",
            json!({"queuedSubmissionId":"not-created"}),
        ),
    ] {
        let mut params = extra;
        params["threadId"] = json!(thread_id);
        params["input"] = oversized.clone();
        let response = request(&server, id, method, params).await;
        assert_eq!(
            response["error"], expected_error,
            "{method} shared input error"
        );
    }
    assert!(
        captured.try_recv().is_err(),
        "oversized input must not reach backend"
    );
    let read = request(
        &server,
        7,
        "thread/read",
        json!({"threadId":thread_id,"includeTurns":true}),
    )
    .await;
    assert_eq!(
        read["result"]["thread"]["turns"],
        json!([]),
        "rejection must not create canonical turns: {read}"
    );
    assert_eq!(
        read["result"]["thread"]["extra"], original["result"]["thread"]["extra"],
        "rejection must not mutate settings: {read}"
    );
    let queue = request(
        &server,
        8,
        "thread/queue/list",
        json!({"threadId":thread_id}),
    )
    .await;
    assert_eq!(
        queue["result"]["data"],
        json!([]),
        "rejection must not persist queued input: {queue}"
    );

    let boundary = json!([
        {"type":"text", "text":format!("\u{3000}{}", "界".repeat(MAX_USER_INPUT_TEXT_CHARS / 2 - 1)),
         "text_elements":[{"byteRange":{"start":3,"end":6}}]},
        {"type":"text", "text":"🙂".repeat(MAX_USER_INPUT_TEXT_CHARS / 2)},
        {"type":"skill", "name":"review", "path":"/skills/review/SKILL.md"},
        {"type":"mention", "name":"docs", "path":"app://docs"}
    ]);
    let accepted = request(
        &server,
        9,
        "turn/start",
        json!({"threadId":thread_id, "input":boundary}),
    )
    .await;
    let turn_id = accepted
        .pointer("/result/turn/id")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("boundary Unicode input must be accepted: {accepted}"));
    let execution = timeout(Duration::from_secs(5), captured.recv())
        .await
        .expect("boundary input must reach backend")
        .expect("capture channel open");
    let expected = serde_json::from_value::<Vec<UserInput>>(boundary.clone())
        .expect("boundary v2 input")
        .into_iter()
        .map(UserInput::into_core)
        .collect::<Vec<_>>();
    assert_eq!(execution.turn.thread_id, thread_id);
    assert_eq!(execution.turn.turn_id, turn_id);
    let expected =
        agent_runtime::reply_input::RuntimeReplyInput::try_from_user_parts(expected, |_| {
            Err::<agent_runtime::reply_input::RuntimeReplyInputImage, _>("unexpected media")
        })
        .expect("expected ordered runtime input");
    assert_eq!(
        execution.input, expected,
        "server must not trim GUI text or flatten rich input"
    );

    let queued = request(
        &server,
        10,
        "thread/queue/add",
        json!({
            "threadId":thread_id, "input":boundary,
            "clientUserMessageId":"keep-queued"
        }),
    )
    .await;
    let queued_id = queued
        .pointer("/result/queuedSubmission/id")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("valid queue input: {queued}"));
    assert_eq!(
        queued["result"]["queuedSubmission"]["input"], boundary,
        "queue boundary must preserve the complete rich input"
    );
    let before = request(
        &server,
        11,
        "thread/queue/list",
        json!({"threadId":thread_id}),
    )
    .await;
    let rejected_update = request(
        &server,
        12,
        "thread/queue/update",
        json!({
            "threadId":thread_id, "queuedSubmissionId":queued_id, "input":oversized
        }),
    )
    .await;
    assert_eq!(rejected_update["error"], expected_error);
    let after = request(
        &server,
        13,
        "thread/queue/list",
        json!({"threadId":thread_id}),
    )
    .await;
    assert_eq!(
        after["result"], before["result"],
        "failed update must preserve exact canonical queue entry"
    );
    request(
        &server,
        14,
        "thread/queue/delete",
        json!({"threadId":thread_id,"queuedSubmissionId":queued_id}),
    )
    .await;
    backend.release.notify_one();
    timeout(Duration::from_secs(5), backend.completed.notified())
        .await
        .expect("accepted boundary turn must emit a real terminal event");
    let completed = request(
        &server,
        15,
        "thread/read",
        json!({"threadId":thread_id,"includeTurns":true}),
    )
    .await;
    assert_eq!(completed["result"]["thread"]["turns"][0]["id"], turn_id);
    assert_eq!(
        completed["result"]["thread"]["turns"][0]["status"],
        "completed"
    );
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({
                "jsonrpc":"2.0", "id":id, "method":method, "params":params
            })
            .to_string(),
        )
        .await
        .unwrap_or_else(|error| panic!("{method} JSON-RPC transport: {error}"));
    let responses = lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).expect("JSON-RPC response"))
        .filter(|message| message.get("id") == Some(&json!(id)))
        .collect::<Vec<_>>();
    assert_eq!(
        responses.len(),
        1,
        "{method} must return one JSON-RPC response"
    );
    responses.into_iter().next().expect("one response")
}
