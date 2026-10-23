//! Configuration defaults are snapshots of new Threads, shared by every host.
use app_server::{
    ActionRespondRequest, AppServer, CancelExecutionRequest, EventLogWriter, ExecutionBackend,
    ExecutionRequest, ProjectionStore, RuntimeCore, RuntimeCoreError, RuntimeEvent,
    RuntimeEventSink,
};
use app_server_protocol::RuntimeRequest;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

#[allow(dead_code)]
#[path = "turn_reasoning_history_jsonrpc/provider.rs"]
mod provider;
#[path = "output_defaults_jsonrpc/provider.rs"]
mod provider_output;
mod support;

struct Capture(mpsc::UnboundedSender<RuntimeRequest>);

#[async_trait]
impl ExecutionBackend for Capture {
    async fn start_turn(
        &self,
        request: ExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        self.0
            .send(request.runtime_request().cloned().unwrap_or_default())
            .unwrap();
        sink.emit(RuntimeEvent::new("turn.started", json!({})))?;
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
async fn output_defaults_snapshot_overrides_and_cold_restore_use_the_same_owner() {
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("config.yaml");
    std::fs::write(&config, "server:\n  api_key: output-fixture-key\n").unwrap();
    let agent_root = temp.path().join("agent");
    let store = Arc::new(
        ProjectionStore::initialize_with_agent_root(
            agent_root.join("projection.sqlite"),
            &agent_root,
        )
        .unwrap(),
    );
    let log = Arc::new(EventLogWriter::new(temp.path().join("events")).unwrap());
    let (tx, mut captures) = mpsc::unbounded_channel();
    let make_server = || {
        AppServer::with_runtime(
            RuntimeCore::with_backend(Arc::new(Capture(tx.clone())))
                .with_projection_store(store.clone())
                .with_event_log_writer(log.clone())
                .with_app_config_path(config.clone()),
        )
    };
    let server = make_server();
    initialize(&server).await;
    let initial = call(&server, "config/read", json!({"includeLayers":true})).await;
    assert_eq!(initial["config"]["model_reasoning_summary"], "auto");
    assert!(initial["config"].get("model_verbosity").is_none());
    let saved = call(
        &server,
        "config/batchWrite",
        json!({
            "expectedVersion":initial["layers"][0]["version"],
            "edits":[
                {"keyPath":"model_verbosity","value":"high","mergeStrategy":"upsert"},
                {"keyPath":"model_reasoning_summary","value":"detailed","mergeStrategy":"upsert"}
            ]
        }),
    )
    .await;
    assert_eq!(saved["status"], "ok");
    let first = start(&server, json!({})).await;
    assert_eq!(first["extra"]["modelVerbosity"], "high");
    assert_eq!(first["extra"]["reasoningSummary"], "detailed");
    let bytes = std::fs::read(&config).unwrap();
    for params in [
        json!({"keyPath":"model_verbosity","value":"verbose","mergeStrategy":"replace"}),
        json!({"keyPath":"model_reasoning_summary","value":false,"mergeStrategy":"replace"}),
        json!({"keyPath":"model_verbosity","value":"low","mergeStrategy":"replace","expectedVersion":"stale"}),
    ] {
        assert!(raw(&server, "config/value/write", params)
            .await
            .get("error")
            .is_some());
        assert_eq!(std::fs::read(&config).unwrap(), bytes);
    }
    call(
        &server,
        "config/batchWrite",
        json!({"edits":[
            {"keyPath":"model_verbosity","value":"low","mergeStrategy":"replace"},
            {"keyPath":"model_reasoning_summary","value":"none","mergeStrategy":"replace"}
        ]}),
    )
    .await;
    let second = start(&server, json!({})).await;
    assert_eq!(second["extra"]["modelVerbosity"], "low");
    assert_eq!(second["extra"]["reasoningSummary"], "none");
    let overridden = start(
        &server,
        json!({"config":{"model_verbosity":null,"model_reasoning_summary":"concise"}}),
    )
    .await;
    assert!(overridden["extra"]["modelVerbosity"].is_null());
    assert_eq!(overridden["extra"]["reasoningSummary"], "concise");
    let model_default = start(&server, json!({"config":{"model_reasoning_summary":null}})).await;
    assert_eq!(model_default["extra"]["reasoningSummary"], "auto");
    let invalid = raw(
        &server,
        "thread/start",
        json!({"config":{"model_verbosity":"invalid"}}),
    )
    .await;
    assert!(invalid.get("error").is_some());

    turn(&server, &first["id"], None).await;
    let request = timeout(Duration::from_secs(5), captures.recv())
        .await
        .unwrap()
        .unwrap();
    let metadata = request.metadata.unwrap();
    assert_eq!(metadata["modelVerbosity"], "high");
    assert_eq!(metadata["reasoningSummary"], "detailed");
    turn(&server, &first["id"], Some("none")).await;
    let request = timeout(Duration::from_secs(5), captures.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(request.metadata.as_ref().unwrap()["summary"], "none");
    for (method, params) in [
        (
            "turn/start",
            json!({"threadId":first["id"],"input":[{"type":"text","text":"invalid output"}],"summary":"invalid"}),
        ),
        (
            "thread/settings/update",
            json!({"threadId":first["id"],"summary":{"mode":"detailed"}}),
        ),
    ] {
        assert!(raw(&server, method, params).await.get("error").is_some());
    }
    drop(server);
    let server = make_server();
    initialize(&server).await;
    let resumed = call(&server, "thread/resume", json!({"threadId":first["id"]})).await;
    assert_eq!(resumed["thread"]["extra"]["reasoningSummary"], "none");
    turn(&server, &first["id"], None).await;
    let request = timeout(Duration::from_secs(5), captures.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(request.metadata.unwrap()["reasoningSummary"], "none");
    call(
        &server,
        "thread/settings/update",
        json!({"threadId":first["id"],"summary":"concise"}),
    )
    .await;
    for key in ["model_verbosity", "model_reasoning_summary"] {
        call(
            &server,
            "config/value/write",
            json!({
                "keyPath":key,"value":null,"mergeStrategy":"replace"
            }),
        )
        .await;
    }
    let cleared = call(&server, "config/read", json!({})).await;
    assert!(cleared["config"].get("model_verbosity").is_none());
    assert_eq!(cleared["config"]["model_reasoning_summary"], "auto");
    drop(server);

    let restored = make_server();
    initialize(&restored).await;
    let resumed = call(&restored, "thread/resume", json!({"threadId":first["id"]})).await;
    assert_eq!(resumed["thread"]["extra"]["modelVerbosity"], "high");
    assert_eq!(resumed["thread"]["extra"]["reasoningSummary"], "concise");
    turn(&restored, &first["id"], None).await;
    let request = timeout(Duration::from_secs(5), captures.recv())
        .await
        .unwrap()
        .unwrap();
    let metadata = request.metadata.unwrap();
    assert_eq!(metadata["modelVerbosity"], "high");
    assert_eq!(metadata["reasoningSummary"], "concise");
    assert!(
        metadata.get("summary").is_none(),
        "the per-request alias must not shadow the durable summary"
    );
}

async fn start(server: &AppServer, extra: Value) -> Value {
    let mut params = json!({"model":"fixture-model","modelProvider":"fixture-provider"});
    params
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    call(server, "thread/start", params).await["thread"].clone()
}

async fn turn(server: &AppServer, thread: &Value, summary: Option<&str>) {
    let mut events = server.subscribe_outbound_messages();
    let mut params = json!({"threadId":thread,"input":[{"type":"text","text":"output fixture"}]});
    if let Some(summary) = summary {
        params["summary"] = json!(summary);
    }
    let started = call(server, "turn/start", params).await;
    timeout(Duration::from_secs(10), async {
        loop {
            let message = serde_json::to_value(events.recv().await.unwrap()).unwrap();
            if message["method"] == "turn/completed"
                && message["params"]["turn"]["id"] == started["turn"]["id"]
            {
                assert_eq!(
                    message["params"]["turn"]["status"], "completed",
                    "{message}"
                );
                break;
            }
        }
    })
    .await
    .expect("fixture turn must terminate");
}

async fn initialize(server: &AppServer) {
    call(server, "initialize", json!({"clientInfo":{"name":"output-defaults-test","version":"1"},"capabilities":{"experimentalApi":true}})).await;
    server
        .handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized"}).to_string())
        .await
        .unwrap();
}

async fn call(server: &AppServer, method: &str, params: Value) -> Value {
    let response = raw(server, method, params).await;
    assert!(response.get("error").is_none(), "{method}: {response}");
    response["result"].clone()
}

async fn raw(server: &AppServer, method: &str, params: Value) -> Value {
    server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        )
        .await
        .unwrap()
        .into_iter()
        .map(|line| serde_json::from_str::<Value>(&line).unwrap())
        .find(|message| message.get("id") == Some(&json!(1)))
        .unwrap()
}
