//! Real process-owned Code Mode delegates to the same canonical Computer Use gateway.

use super::*;
use app_server::{AppServerRuntimeFactory, LocalAppDataSource};
use lime_core::database::schema::create_tables;
use tokio::time::{timeout, Duration};

struct Fixture {
    _temp: tempfile::TempDir,
    provider: ModelFixture,
    adapter: Arc<TestAdapter>,
    server: AppServer,
    client: TransportClient,
    thread: String,
    session: String,
    grant_id: Option<String>,
    events: Arc<EventLogWriter>,
}

impl Fixture {
    async fn start(grant: bool, block: bool) -> Self {
        assert!(
            ::code_mode::default_code_mode_host_path().is_file(),
            "build the current code-mode-host binary before this integration test"
        );
        let wire = Wire::Responses;
        let source = format!(
            "text(await tools.computer_use({{operation:{{action:'status'}}}}));\n\
             try {{ const result = await tools.computer_use({args}); text(result.structuredContent); image(result.content.find(item => item.type === 'image')); throw new Error('fixture failure after image'); }} catch (e) {{ throw e; }}",
            args = json!({"target":target(),"operation":{"action":"screenshot"}})
        );
        let provider = ModelFixture::start_with_custom_tool(
            wire,
            json!({"data":[{"id":wire.model(),"tool_mode":"code_mode_only",
                "runtime_features":["streaming","tool_calling","custom_tools"]}]}),
            "exec",
            source,
        )
        .await;
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.yaml");
        std::fs::write(
            &config,
            "server:\n  api_key: test-only\nfeatures:\n  computer_use: true\ncomputer_use:\n  default_app_access: allow\n",
        )
        .unwrap();
        let db = Arc::new(Mutex::new(rusqlite::Connection::open_in_memory().unwrap()));
        create_tables(&db.lock().unwrap()).unwrap();
        support::seed_chat_providers(
            &db,
            &[(
                PROVIDER,
                wire.model(),
                wire.provider_type(),
                &provider.url,
                wire.credential(),
            )],
            false,
        );
        let app_data = LocalAppDataSource::initialize_with_roots(
            db.clone(),
            temp.path(),
            temp.path().join("agent"),
        )
        .await
        .unwrap();
        let adapter = Arc::new(TestAdapter::default());
        adapter.block.store(block, Ordering::Release);
        let events = Arc::new(EventLogWriter::new(temp.path().join("events")).unwrap());
        let runtime = AppServerRuntimeFactory::runtime_backend_core_with_db(db)
            .with_app_data_source(Arc::new(app_data))
            .with_projection_store(Arc::new(
                app_server::ProjectionStore::initialize(temp.path().join("projection.sqlite"))
                    .unwrap(),
            ))
            .with_event_log_writer(events.clone())
            .with_app_config_path(config)
            .with_requirements_path(temp.path().join("requirements.toml"))
            .with_computer_use_service(
                ComputerUseService::default()
                    .with_control_directory(temp.path().join("control"))
                    .with_adapter(adapter.clone()),
            );
        let server =
            AppServer::with_runtime(runtime).with_thread_unloading_delay(Duration::from_millis(25));
        let mut client = TransportClient::start(server.clone(), "computer-use-code-mode").await;
        client.request_ok(2, "modelProvider/update", json!({
            "providerId":PROVIDER,"models":[{"id":wire.model(),"capability":{
                "taskFamilies":["chat"],"inputModalities":["text"],"outputModalities":["text"],
                "runtimeFeatures":["streaming","tool_calling","custom_tools"],
                "capabilities":app_server_protocol::ModelCapabilitiesInfo {
                    tools:true,streaming:true,function_calling:true, ..Default::default()
                }
            }}]
        })).await;
        let models = client
            .request_ok(
                3,
                "modelProvider/fetchModels",
                json!({"providerId":PROVIDER}),
            )
            .await;
        assert_eq!(
            models["result"]["models"][0]["toolMode"], "code_mode_only",
            "{models}"
        );
        let grant_id = if grant {
            let setup = client
                .request_ok(
                    4,
                    "computerUse/setup",
                    json!({"adapter":"native","target":target()}),
                )
                .await;
            Some(setup["result"]["grant"]["id"].as_str().unwrap().to_string())
        } else {
            None
        };
        let started = client
            .request_ok(
                5,
                "thread/start",
                json!({
                    "cwd":temp.path(),"model":wire.model(),"modelProvider":PROVIDER
                }),
            )
            .await;
        Self {
            thread: started["result"]["thread"]["id"].as_str().unwrap().into(),
            session: started["result"]["thread"]["sessionId"]
                .as_str()
                .unwrap()
                .into(),
            _temp: temp,
            provider,
            adapter,
            server,
            client,
            grant_id,
            events,
        }
    }

    async fn turn(&mut self, id: u64) -> String {
        let response = self.client.request_ok(id, "turn/start", json!({
            "threadId":self.thread,"input":[{"type":"text","text":"use Code Mode to discover and observe the authorized window"}]
        })).await;
        response["result"]["turn"]["id"].as_str().unwrap().into()
    }

    async fn shutdown(mut self) {
        let mut outbound = self.server.subscribe_outbound_messages();
        self.client
            .request_ok(100, "thread/unsubscribe", json!({"threadId":self.thread}))
            .await;
        timeout(Duration::from_secs(10), async {
            loop {
                let message = serde_json::to_value(outbound.recv().await.unwrap()).unwrap();
                if message["method"] == "thread/closed"
                    && message["params"]["threadId"] == self.thread
                {
                    break;
                }
            }
        })
        .await
        .expect("thread/closed must confirm Code Mode host cleanup before transport EOF");
        self.client.shutdown().await;
    }
}

async fn completed_code_mode(grant: bool) {
    let mut fixture = Fixture::start(grant, false).await;
    let mut outbound = fixture.server.subscribe_outbound_messages();
    let turn = fixture.turn(10).await;
    let completed = terminal(&mut outbound, &turn).await;
    assert_eq!(
        completed["params"]["turn"]["status"], "completed",
        "{completed}"
    );
    let capture = fixture.provider.last_request();
    capture.assert_route(Wire::Responses);
    let tools = capture.body["tools"].as_array().unwrap();
    assert!(tools
        .iter()
        .any(|tool| tool["type"] == "custom" && tool["name"] == "exec"));
    assert!(
        !tools.iter().any(|tool| tool["name"] == "computer_use"),
        "must execute a nested call, not direct fallback"
    );
    let history = capture.history().as_array().unwrap();
    let call = history
        .iter()
        .find(|item| item["type"] == "custom_tool_call")
        .unwrap();
    let result = history
        .iter()
        .find(|item| item["type"] == "custom_tool_call_output")
        .unwrap();
    assert_eq!(call["name"], "exec");
    assert_eq!(call["call_id"], result["call_id"]);
    let output = result["output"]
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            result["output"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|item| item["text"].as_str())
                .collect::<String>()
        });
    assert!(
        output.contains("com.example.ProviderFixture"),
        "status readback: {output}"
    );
    if grant {
        assert!(output.contains(OBSERVATION), "{output}");
        assert!(output.contains("fixture failure after image"));
        assert!(!output.contains(PNG));
        assert!(result["output"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["type"] == "input_image"
                && item["image_url"] == format!("data:image/png;base64,{PNG}")));
        let calls = fixture.adapter.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].thread_id, fixture.thread);
        assert_eq!(calls[0].turn_id, turn);
        assert!(calls[0].connection.starts_with("transport:"));
    } else {
        assert!(output.contains("existing target grant"), "{output}");
        assert!(!output.contains(OBSERVATION));
        assert!(fixture.adapter.calls.lock().unwrap().is_empty());
    }
    let events = fixture
        .events
        .read_session_events(&fixture.session)
        .unwrap();
    let terminals = events
        .iter()
        .filter(|record| record.event.event_type == "item.completed")
        .filter_map(|record| {
            let item: agent_protocol::ThreadItem =
                serde_json::from_value(record.event.payload["item"].clone()).unwrap();
            match item.payload {
                agent_protocol::ThreadItemPayload::Tool { name, call_id, .. }
                    if name == "computer_use" =>
                {
                    Some((record, call_id))
                }
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    assert_eq!(
        terminals.len(),
        2,
        "status and observe must both reach the canonical tool lifecycle"
    );
    for (record, call_id) in terminals {
        assert_eq!(
            record.event.thread_id.as_deref(),
            Some(fixture.thread.as_str())
        );
        assert_eq!(record.event.turn_id.as_deref(), Some(turn.as_str()));
        assert!(call_id.starts_with("code-mode-"), "{call_id}");
    }
    fixture.shutdown().await;
}

async fn terminal(
    outbound: &mut tokio::sync::broadcast::Receiver<app_server::JsonRpcMessage>,
    turn: &str,
) -> Value {
    timeout(Duration::from_secs(20), async {
        loop {
            let message = serde_json::to_value(outbound.recv().await.unwrap()).unwrap();
            if message["method"] == "turn/completed" && message["params"]["turn"]["id"] == turn {
                return message;
            }
        }
    })
    .await
    .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn code_mode_process_preserves_computer_use_authority_and_model_readback() {
    completed_code_mode(true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn code_mode_process_cannot_grant_its_own_computer_access() {
    completed_code_mode(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn interrupt_cancels_nested_computer_use_and_releases_control_for_next_turn() {
    let mut fixture = Fixture::start(true, true).await;
    let mut outbound = fixture.server.subscribe_outbound_messages();
    let turn = fixture.turn(10).await;
    timeout(Duration::from_secs(15), fixture.adapter.entered.notified())
        .await
        .unwrap();
    fixture
        .client
        .request_ok(
            11,
            "turn/interrupt",
            json!({"threadId":fixture.thread,"turnId":turn}),
        )
        .await;
    timeout(Duration::from_secs(5), fixture.adapter.stopped.notified())
        .await
        .unwrap();
    assert!(fixture.adapter.canceled.load(Ordering::Acquire));
    timeout(Duration::from_secs(10), async {
        loop {
            let message = serde_json::to_value(outbound.recv().await.unwrap()).unwrap();
            if message["method"] == "turn/completed" && message["params"]["turn"]["id"] == turn {
                assert_eq!(message["params"]["turn"]["status"], "interrupted");
                break;
            }
        }
    })
    .await
    .unwrap();
    let (sampling, release) = fixture.provider.hold_next_sampling();
    let next = fixture.turn(12).await;
    timeout(Duration::from_secs(10), sampling)
        .await
        .unwrap()
        .unwrap();
    let lease = fixture
        .client
        .request_ok(
            13,
            "computerUse/lease/acquire",
            json!({
                "threadId":fixture.thread,"turnId":next,"adapter":"native","target":target(),
                "capability":"observe","grantId":fixture.grant_id
            }),
        )
        .await;
    assert!(
        lease["result"]["leaseId"].is_string(),
        "canceled nested call retained control: {lease}"
    );
    fixture
        .client
        .request_ok(
            14,
            "computerUse/lease/release",
            json!({"leaseId":lease["result"]["leaseId"]}),
        )
        .await;
    release.send(()).unwrap();
    fixture
        .client
        .wait_for_turn_completed(&fixture.thread, &next)
        .await;
    assert_eq!(fixture.adapter.calls.lock().unwrap().len(), 1);
    fixture.shutdown().await;
}
