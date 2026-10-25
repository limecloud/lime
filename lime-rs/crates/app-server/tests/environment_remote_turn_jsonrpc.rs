mod support;

use std::sync::{Arc, Mutex};

use app_server::{AppServer, EventLogWriter, RuntimeCore};
use app_server_protocol::protocol::v2::{METHOD_ENVIRONMENT_ADD, METHOD_ENVIRONMENT_STATUS};
use app_server_protocol::{
    METHOD_THREAD_READ, METHOD_THREAD_RESUME, METHOD_THREAD_START, METHOD_TURN_START,
};
use base64::Engine;
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use support::{json_lines_transport::TransportClient, provider_fixture::ProviderFixture};
use tempfile::TempDir;
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

const PROVIDER_ID: &str = "remote-turn-provider";
const MODEL_ID: &str = "remote-turn-model";
const ENVIRONMENT_ID: &str = "remote-turn-environment";
const REMOTE_CWD: &str = "/remote/workspace";
const REMOTE_OUTPUT: &str = "remote-process-output";

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_environment_executes_provider_tool_and_survives_cold_resume() {
    let temp = TempDir::new().expect("remote turn temp dir");
    let provider = ProviderFixture::start(
        MODEL_ID,
        json!({"cmd":"printf local-command-must-not-run"}),
        "remote-exec-call",
    )
    .await;
    let remote = RemoteExecFixture::start().await;

    let mut first = TransportClient::start(
        AppServer::with_runtime(runtime(&temp, &provider.base_url)),
        "environment-remote-turn-first",
    )
    .await;
    first
        .request_ok(
            2,
            METHOD_ENVIRONMENT_ADD,
            json!({
                "environmentId": ENVIRONMENT_ID,
                "execServerUrl": remote.url,
            }),
        )
        .await;
    wait_for_environment_ready(&mut first, 10).await;

    let started = first
        .request_ok(
            30,
            METHOD_THREAD_START,
            json!({
                "model": MODEL_ID,
                "modelProvider": PROVIDER_ID,
                "cwd": temp.path(),
                "historyMode": "paginated",
                "environments": [{
                    "environmentId": ENVIRONMENT_ID,
                    "cwd": REMOTE_CWD,
                    "runtimeWorkspaceRoots": [REMOTE_CWD]
                }]
            }),
        )
        .await;
    let thread_id = required_string(&started, "/result/thread/id", "thread/start id");

    let first_turn_id = start_turn(&mut first, 31, &thread_id, "first remote command").await;
    first
        .wait_for_turn_completed(&thread_id, &first_turn_id)
        .await;
    let first_read = first
        .request_ok(
            32,
            METHOD_THREAD_READ,
            json!({"threadId": thread_id, "includeTurns": true}),
        )
        .await;
    assert_eq!(
        first_read.pointer("/result/thread/extra/environmentWorldState/0/environmentId"),
        Some(&json!(ENVIRONMENT_ID))
    );
    assert_eq!(
        first_read.pointer("/result/thread/extra/environmentWorldState/0/status"),
        Some(&json!("ready"))
    );
    assert_remote_command_item(&first_read, 1, &provider.requests(), &remote.requests());
    first.shutdown().await;

    let mut resumed = TransportClient::start(
        AppServer::with_runtime(runtime(&temp, &provider.base_url)),
        "environment-remote-turn-resumed",
    )
    .await;
    wait_for_environment_ready(&mut resumed, 40).await;
    let resume = resumed
        .request_ok(
            60,
            METHOD_THREAD_RESUME,
            json!({"threadId": thread_id, "excludeTurns": true}),
        )
        .await;
    assert_eq!(
        resume.pointer("/result/thread/id").and_then(Value::as_str),
        Some(thread_id.as_str())
    );

    let second_turn_id = start_turn(&mut resumed, 61, &thread_id, "second remote command").await;
    resumed
        .wait_for_turn_completed(&thread_id, &second_turn_id)
        .await;
    let second_read = resumed
        .request_ok(
            62,
            METHOD_THREAD_READ,
            json!({"threadId": thread_id, "includeTurns": true}),
        )
        .await;
    assert_remote_command_item(&second_read, 2, &provider.requests(), &remote.requests());

    let remote_requests = remote.requests();
    let starts = remote_requests
        .iter()
        .filter(|request| request["method"] == "process/start")
        .collect::<Vec<_>>();
    assert_eq!(starts.len(), 2, "each turn must start one remote process");
    for start in starts {
        assert_eq!(
            start.pointer("/params/cwd"),
            Some(&json!("file:///remote/workspace"))
        );
        assert!(start
            .pointer("/params/argv")
            .and_then(Value::as_array)
            .is_some_and(|argv| argv.iter().any(|part| {
                part.as_str()
                    .is_some_and(|part| part.contains("local-command-must-not-run"))
            })));
    }
    assert!(
        remote_requests
            .iter()
            .filter(|request| request["method"] == "initialize")
            .count()
            >= 2,
        "cold App Server must hydrate and reconnect the persisted Environment registry"
    );
    assert!(
        provider
            .requests()
            .iter()
            .filter(|request| request["stream"] == true)
            .count()
            >= 4,
        "two turns must each sample before and after the remote tool result"
    );

    resumed.shutdown().await;
}

fn runtime(temp: &TempDir, provider_base_url: &str) -> RuntimeCore {
    support::runtime_core_with_chat_provider_at(temp, PROVIDER_ID, MODEL_ID, provider_base_url)
        .with_event_log_writer(Arc::new(
            EventLogWriter::new(temp.path().join("event-log")).expect("event log writer"),
        ))
        .with_app_config_path(temp.path().join("config").join("config.yaml"))
}

async fn start_turn(
    client: &mut TransportClient,
    id: u64,
    thread_id: &str,
    prompt: &str,
) -> String {
    let response = client
        .request_ok(
            id,
            METHOD_TURN_START,
            json!({
                "threadId": thread_id,
                "input": [{"type": "text", "text": prompt}],
                "model": MODEL_ID,
                "approvalPolicy": "never",
                "sandboxPolicy": "workspace-write"
            }),
        )
        .await;
    required_string(&response, "/result/turn/id", "turn/start id")
}

async fn wait_for_environment_ready(client: &mut TransportClient, first_id: u64) {
    for id in first_id..first_id + 20 {
        let status = client
            .request_ok(
                id,
                METHOD_ENVIRONMENT_STATUS,
                json!({"environmentId": ENVIRONMENT_ID}),
            )
            .await;
        if status.pointer("/result/status") == Some(&json!("ready")) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("remote Environment did not become ready");
}

fn assert_remote_command_item(
    read: &Value,
    expected_turns: usize,
    provider_requests: &[Value],
    remote_requests: &[Value],
) {
    let turns = read
        .pointer("/result/thread/turns")
        .and_then(Value::as_array)
        .expect("thread/read turns");
    assert_eq!(turns.len(), expected_turns);
    let command = turns
        .last()
        .expect("latest remote turn")
        .get("items")
        .and_then(Value::as_array)
        .expect("latest remote turn items")
        .iter()
        .find(|item| item["type"] == "commandExecution")
        .expect("remote commandExecution item");
    assert_eq!(
        command["status"],
        "completed",
        "remote command projection: {command:#}; provider tool results: {:?}; remote methods: {:?}",
        provider_tool_results(provider_requests),
        remote_requests
            .iter()
            .filter_map(|request| request["method"].as_str())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        command["exitCode"], 0,
        "remote command projection: {command:#}"
    );
    assert_eq!(
        command["aggregatedOutput"], REMOTE_OUTPUT,
        "remote command projection: {command:#}"
    );
}

fn provider_tool_results(requests: &[Value]) -> Vec<Value> {
    requests
        .iter()
        .flat_map(|request| request["messages"].as_array())
        .flatten()
        .filter(|message| message["role"] == "tool")
        .map(|message| {
            json!({
                "tool_call_id": message["tool_call_id"].clone(),
                "content": message["content"].clone()
            })
        })
        .collect()
}

fn required_string(value: &Value, pointer: &str, scenario: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("missing {scenario}: {value:#}"))
        .to_string()
}

struct RemoteExecFixture {
    url: String,
    requests: Arc<Mutex<Vec<Value>>>,
    task: JoinHandle<()>,
}

impl RemoteExecFixture {
    async fn start() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind remote exec fixture");
        let address = listener.local_addr().expect("remote exec fixture address");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let fixture_requests = Arc::clone(&requests);
        let task = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let requests = Arc::clone(&fixture_requests);
                tokio::spawn(async move {
                    let Ok(mut socket) = accept_async(stream).await else {
                        return;
                    };
                    while let Some(message) = socket.next().await {
                        let Ok(Message::Text(text)) = message else {
                            continue;
                        };
                        let request: Value =
                            serde_json::from_str(&text).expect("remote exec request JSON");
                        requests
                            .lock()
                            .expect("remote exec requests")
                            .push(request.clone());
                        let Some(id) = request.get("id") else {
                            continue;
                        };
                        let result = match request["method"].as_str().unwrap_or_default() {
                            "initialize" => json!({"sessionId": "remote-turn-session"}),
                            "environment/info" => json!({
                                "shell": {"name": "fixture-sh", "path": "/bin/fixture-sh"},
                                "cwd": "file:///remote/workspace"
                            }),
                            "environment/status" => json!({"status": "ready"}),
                            "process/start" => json!({
                                "processId": request["params"]["processId"].clone()
                            }),
                            "process/read" => json!({
                                "chunks": [{
                                    "seq": 0,
                                    "stream": "stdout",
                                    "chunk": base64::engine::general_purpose::STANDARD
                                        .encode(REMOTE_OUTPUT)
                                }],
                                "nextSeq": 1,
                                "exited": true,
                                "exitCode": 0,
                                "closed": false,
                                "failure": null,
                                "sandboxDenied": false
                            }),
                            "process/write" | "process/signal" | "process/terminate" => json!({}),
                            method => panic!("unexpected remote exec method: {method}"),
                        };
                        socket
                            .send(Message::Text(
                                json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string(),
                            ))
                            .await
                            .expect("send remote exec response");
                    }
                });
            }
        });
        Self {
            url: format!("ws://{address}"),
            requests,
            task,
        }
    }

    fn requests(&self) -> Vec<Value> {
        self.requests.lock().expect("remote exec requests").clone()
    }
}

impl Drop for RemoteExecFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
