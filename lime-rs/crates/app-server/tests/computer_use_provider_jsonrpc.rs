//! Real provider wires and runtime; the adapter is explicitly a test dependency.

#[path = "computer_use_provider_jsonrpc/code_mode.rs"]
mod code_mode;
#[allow(dead_code)]
#[path = "thread_compact_jsonrpc/model_fixture.rs"]
mod provider;
mod support;

use agent_runtime::model_history::{ModelHistoryRecord, MODEL_HISTORY_EVENT_TYPE};
use app_server::{AppServer, EventLogWriter};
use app_server_protocol::protocol::v2::*;
use async_trait::async_trait;
use model_provider::current_client::CurrentProviderContent;
use provider::{ModelFixture, Wire};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use support::json_lines_transport::TransportClient;
use tool_runtime::computer_use::*;

const PROVIDER: &str = "computer-use-provider";
const OBSERVATION: &str = "computer-use-provider-observed-window";

#[derive(Default)]
struct TestAdapter {
    calls: Mutex<Vec<ComputerUseOwner>>,
    block: AtomicBool,
    entered: tokio::sync::Notify,
    canceled: AtomicBool,
    stopped: tokio::sync::Notify,
}

fn target() -> ComputerUseTargetIdentity {
    ComputerUseTargetIdentity::Native {
        app_id: "com.example.ProviderFixture".into(),
        process_id: Some(42),
        window_id: Some("12".into()),
        title: None,
    }
}

#[async_trait]
impl ComputerUseAdapter for TestAdapter {
    fn kind(&self) -> ComputerUseAdapterKind {
        ComputerUseAdapterKind::Native
    }

    async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
        Ok(ComputerUseSnapshot {
            generation: 1,
            readiness: ComputerUseReadiness::Ready,
            targets: vec![ComputerUseTarget {
                identity: target(),
                native_app: Some(NativeAppIdentity::Macos {
                    bundle_id: "com.example.ProviderFixture".into(),
                }),
                capabilities: vec![ComputerUseCapability::Observe],
                locked: false,
            }],
            reason: None,
            setup_steps: vec![],
        })
    }

    async fn setup(
        &self,
        _: &ComputerUseSetupParams,
    ) -> ComputerUseResult<ComputerUseSetupOutcome> {
        Ok(ComputerUseSetupOutcome {
            accepted: true,
            approved_target: None,
            generation: 1,
        })
    }

    async fn execute(
        &self,
        lease: &ComputerUseLease,
        action: ComputerUseAction,
        cancel: tokio_util::sync::CancellationToken,
    ) -> ComputerUseResult<Value> {
        assert!(!cancel.is_cancelled());
        assert!(matches!(action, ComputerUseAction::Observe { .. }));
        assert_eq!(lease.response.target, target());
        assert_eq!(lease.response.capability, ComputerUseCapability::Observe);
        self.calls.lock().unwrap().push(lease.owner.clone());
        self.entered.notify_one();
        if self.block.load(Ordering::Acquire) {
            cancel.cancelled().await;
            self.canceled.store(true, Ordering::Release);
            self.stopped.notify_one();
            return Err(ComputerUseError("test adapter canceled".into()));
        }
        Ok(json!({"observation":OBSERVATION}))
    }
}

async fn provider_turn(wire: Wire, grant: bool) {
    let temp = tempfile::tempdir().unwrap();
    let mut step = 0;
    let fixture = ModelFixture::start_with_script(wire, json!({"data":[]}), move |_| {
        let call = match step {
            0 => Some(("discover", json!({"operation":{"action":"status"}}))),
            1 => Some((
                "observe",
                json!({"target":target(), "operation":{"action":"observe","max_depth":2,"max_nodes":32}}),
            )),
            _ => None,
        };
        step += 1;
        call.map(|(id, args)| (id.into(), "computer_use".into(), args))
    })
    .await;
    let config = temp.path().join("config.yaml");
    std::fs::write(
        &config,
        "server:\n  api_key: test-only\ncomputer_use:\n  default_app_access: allow\n",
    )
    .unwrap();
    let adapter = Arc::new(TestAdapter::default());
    let service = ComputerUseService::default()
        .with_control_directory(temp.path().join("control"))
        .with_adapter(adapter.clone());
    let runtime = support::runtime_core_with_chat_providers_at(
        &temp,
        &[(
            PROVIDER,
            wire.model(),
            wire.provider_type(),
            &fixture.url,
            wire.credential(),
        )],
    )
    .with_event_log_writer(Arc::new(
        EventLogWriter::new(temp.path().join("events")).unwrap(),
    ))
    .with_app_config_path(config)
    .with_requirements_path(temp.path().join("requirements.toml"))
    .with_computer_use_service(service);
    let server = AppServer::with_runtime(runtime)
        .with_thread_unloading_delay(tokio::time::Duration::from_millis(25));
    let mut client = TransportClient::start(server.clone(), "computer-use-provider").await;
    if grant {
        let setup = client
            .request_ok(
                2,
                "computerUse/setup",
                json!({"adapter":"native","target":target()}),
            )
            .await;
        assert!(setup["result"]["grant"]["id"].is_string(), "{setup}");
    }
    let started = client
        .request_ok(
            3,
            "thread/start",
            json!({"cwd":temp.path(),"model":wire.model(),"modelProvider":PROVIDER}),
        )
        .await;
    let thread = started["result"]["thread"]["id"].as_str().unwrap();
    let session = started["result"]["thread"]["sessionId"].as_str().unwrap();
    let started = client
        .request_ok(
            4,
            "turn/start",
            json!({"threadId":thread,"input":[{"type":"text","text":"discover then observe the authorized window"}]}),
        )
        .await;
    let turn = started["result"]["turn"]["id"].as_str().unwrap();
    client.wait_for_turn_completed(thread, turn).await;

    let capture = fixture.last_request();
    capture.assert_route(wire);
    assert_eq!(
        fixture.request_count(),
        3,
        "discovery, observe and readback"
    );
    assert!(capture.body["tools"].to_string().contains("computer_use"));
    let readback = capture.history().to_string();
    assert!(readback.contains("computer_use"), "{readback}");
    assert!(
        readback.contains("com.example.ProviderFixture"),
        "{readback}"
    );
    if grant {
        assert!(readback.contains(OBSERVATION), "{readback}");
        let calls = adapter.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].thread_id, thread);
        assert_eq!(calls[0].turn_id, turn);
        assert!(calls[0].connection.starts_with("transport:"));
    } else {
        assert!(!readback.contains(OBSERVATION));
        assert!(readback.contains("existing target grant"), "{readback}");
        assert!(adapter.calls.lock().unwrap().is_empty());
    }

    let events = EventLogWriter::new(temp.path().join("events"))
        .unwrap()
        .read_session_events(session)
        .unwrap();
    let history = events
        .iter()
        .filter(|record| record.event.event_type == MODEL_HISTORY_EVENT_TYPE)
        .flat_map(|record| {
            assert_eq!(record.event.thread_id.as_deref(), Some(thread));
            assert_eq!(record.event.turn_id.as_deref(), Some(turn));
            serde_json::from_value::<ModelHistoryRecord>(record.event.payload.clone())
                .unwrap()
                .into_message()
                .unwrap()
                .content
        })
        .collect::<Vec<_>>();
    let calls = history
        .iter()
        .filter_map(|part| match part {
            CurrentProviderContent::ToolCall(call) => Some(call),
            _ => None,
        })
        .collect::<Vec<_>>();
    let results = history
        .iter()
        .filter_map(|part| match part {
            CurrentProviderContent::ToolResult(result) => Some(result),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(calls.len(), 2);
    assert_eq!(results.len(), 2);
    assert_ne!(calls[0].id, calls[1].id);
    for (call, result) in calls.iter().zip(&results) {
        assert_eq!(call.name, "computer_use");
        assert_eq!(result.name, call.name);
        assert_eq!(result.call_id, call.id);
    }
    assert!(results[0].success, "read-only discovery needs no grant");
    assert_eq!(results[1].success, grant);
    assert_eq!(
        events
            .iter()
            .filter(|record| record.event.event_type == "item.completed"
                && record.event.payload.to_string().contains("computer_use"))
            .count(),
        2,
        "each computer action must finish in the canonical projection"
    );
    let read = client
        .request_ok(
            5,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        )
        .await;
    assert_eq!(read["result"]["thread"]["turns"][0]["id"], turn);
    assert_eq!(read["result"]["thread"]["turns"][0]["status"], "completed");
    assert!(read.to_string().contains("MODEL-ASSISTANT-NOTE"));
    let mut outbound = server.subscribe_outbound_messages();
    let unsubscribed = client
        .request_ok(6, "thread/unsubscribe", json!({"threadId":thread}))
        .await;
    assert_eq!(unsubscribed["result"]["status"], "unsubscribed");
    tokio::time::timeout(tokio::time::Duration::from_secs(10), async {
        loop {
            let message = serde_json::to_value(outbound.recv().await.unwrap()).unwrap();
            if message["method"] == "thread/closed" && message["params"]["threadId"] == thread {
                break;
            }
        }
    })
    .await
    .expect("thread/closed must confirm runtime cleanup before transport EOF");
    client.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn chat_provider_completes_computer_use_tool_and_model_readback() {
    provider_turn(Wire::Chat, true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn responses_provider_completes_computer_use_tool_and_model_readback() {
    provider_turn(Wire::Responses, true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn anthropic_provider_completes_computer_use_tool_and_model_readback() {
    provider_turn(Wire::Anthropic, true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn gemini_provider_completes_computer_use_tool_and_model_readback() {
    provider_turn(Wire::Gemini, true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn provider_discovers_targets_without_automatically_granting_access() {
    provider_turn(Wire::Chat, false).await;
}
