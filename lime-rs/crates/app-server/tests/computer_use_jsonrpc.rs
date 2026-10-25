//! Explicit test adapter; production installs no fake driver or automatic consent.

use agent_runtime::session_loop::RuntimeSessionInputHandle;
use app_server::{
    ActionRespondRequest, AppServer, CancelExecutionRequest, EventLogWriter, ExecutionBackend,
    ExecutionRequest, ProjectionStore, ProviderTurnHistory, RuntimeCore, RuntimeCoreError,
    RuntimeEvent, RuntimeEventSink,
};
use app_server_protocol::protocol::v2::*;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::Arc;
use std::sync::{Mutex, RwLock};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;
use tool_runtime::computer_use::*;

struct TestAdapter;

fn target() -> ComputerUseTargetIdentity {
    ComputerUseTargetIdentity::Native {
        app_id: "com.example.Editor".into(),
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
                    bundle_id: "com.example.Editor".into(),
                }),
                capabilities: vec![ComputerUseCapability::Observe, ComputerUseCapability::Click],
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
        _: &ComputerUseLease,
        _: ComputerUseAction,
        _: CancellationToken,
    ) -> ComputerUseResult<Value> {
        Ok(json!({"status":"submitted"}))
    }
}

type GatewaySlot = Arc<RwLock<Option<Arc<dyn ComputerUseGateway>>>>;
type ScopeSlot = Arc<Mutex<Option<(String, String)>>>;
struct WaitingBackend(Arc<Notify>, GatewaySlot, ScopeSlot);

#[async_trait]
impl ExecutionBackend for WaitingBackend {
    fn set_computer_use_gateway(
        &self,
        gateway: Arc<dyn ComputerUseGateway>,
    ) -> Result<(), RuntimeCoreError> {
        *self.1.write().unwrap() = Some(gateway);
        Ok(())
    }
    async fn start_turn(
        &self,
        _: ExecutionRequest,
        _: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        unreachable!("current session input boundary")
    }
    async fn start_turn_with_provider_history_and_session_input(
        &self,
        request: ExecutionRequest,
        _: ProviderTurnHistory,
        _: Option<RuntimeSessionInputHandle>,
        cancellation: Option<CancellationToken>,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        *self.2.lock().unwrap() = Some((request.session.session_id, request.turn.turn_id));
        sink.emit(RuntimeEvent::new("turn.started", json!({})))?;
        self.0.notify_one();
        cancellation.expect("task cancellation").cancelled().await;
        Ok(())
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

struct Fixture {
    temp: tempfile::TempDir,
    requirements: std::path::PathBuf,
    started: Arc<Notify>,
    server: AppServer,
    gateway: GatewaySlot,
    scope: ScopeSlot,
}

impl Fixture {
    async fn new(adapter: bool) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.yaml");
        let requirements = temp.path().join("requirements.toml");
        std::fs::write(
            &config,
            "server:\n  api_key: test-only\ncomputer_use:\n  default_app_access: allow\n",
        )
        .unwrap();
        let started = Arc::new(Notify::new());
        let service =
            ComputerUseService::default().with_control_directory(temp.path().join("computer-use"));
        let service = if adapter {
            service.with_adapter(Arc::new(TestAdapter))
        } else {
            service
        };
        let gateway = Arc::new(RwLock::new(None));
        let scope = Arc::new(Mutex::new(None));
        let runtime = RuntimeCore::with_backend(Arc::new(WaitingBackend(
            started.clone(),
            gateway.clone(),
            scope.clone(),
        )))
        .with_event_log_writer(Arc::new(
            EventLogWriter::new(temp.path().join("events")).unwrap(),
        ))
        .with_projection_store(Arc::new(
            ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap(),
        ))
        .with_app_config_path(config)
        .with_requirements_path(requirements.clone())
        .with_computer_use_service(service);
        let server = AppServer::with_runtime(runtime);
        ok(
            &server,
            "initialize",
            json!({"clientInfo":{"name":"computer-use-fixture","version":"1"}}),
        )
        .await;
        server
            .handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized"}).to_string())
            .await
            .unwrap();
        Self {
            temp,
            requirements,
            started,
            server,
            gateway,
            scope,
        }
    }

    async fn grant(&self) -> Value {
        let setup = ok(
            &self.server,
            "computerUse/setup",
            json!({"adapter":"native","target":target()}),
        )
        .await;
        assert!(setup["grant"]["id"].is_string(), "{setup}");
        setup["grant"].clone()
    }

    async fn turn(&self) -> (Value, Value) {
        let thread = ok(
            &self.server,
            "thread/start",
            json!({"cwd":self.temp.path(),"modelProvider":"fixture","model":"model"}),
        )
        .await;
        let thread = thread["thread"]["id"].clone();
        let turn = ok(
            &self.server,
            "turn/start",
            json!({"threadId":thread,"input":[{"type":"text","text":"fixture"}]}),
        )
        .await;
        tokio::time::timeout(std::time::Duration::from_secs(5), self.started.notified())
            .await
            .unwrap();
        (thread, turn["turn"]["id"].clone())
    }
}

async fn call(server: &AppServer, method: &str, params: Value) -> Value {
    server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        )
        .await
        .unwrap()
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|message| message.get("id") == Some(&json!(1)))
        .unwrap()
}
async fn ok(server: &AppServer, method: &str, params: Value) -> Value {
    let response = call(server, method, params).await;
    assert!(response.get("error").is_none(), "{method}: {response}");
    response["result"].clone()
}

#[tokio::test]
async fn model_gateway_uses_the_rpc_turns_connection_grant_and_rejects_terminal_identity() {
    let fixture = Fixture::new(true).await;
    let (thread, turn) = fixture.turn().await;
    let gateway = fixture.gateway.read().unwrap().clone().unwrap();
    let (session_id, turn_id) = fixture.scope.lock().unwrap().clone().unwrap();
    let discovery = gateway
        .execute(
            ComputerUseToolScope {
                session_id: &session_id,
                turn_id: &turn_id,
                call_id: "discovery",
            },
            serde_json::from_value(json!({"operation":{"action":"status"}})).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        discovery["adapters"][0]["targets"][0]["appId"],
        "com.example.Editor"
    );
    let execute = |session: String, turn: String| {
        let gateway = gateway.clone();
        async move {
            gateway
                .execute(
                    ComputerUseToolScope {
                        session_id: &session,
                        turn_id: &turn,
                        call_id: "canonical-tool-call",
                    },
                    ComputerUseToolInput::Action {
                        target: target(),
                        operation: ComputerUseAction::Observe {
                            max_depth: 2,
                            max_nodes: 32,
                        },
                    },
                )
                .await
        }
    };
    assert!(
        execute(session_id.clone(), turn_id.clone()).await.is_err(),
        "no automatic consent"
    );
    fixture.grant().await;
    for _ in 0..2 {
        assert_eq!(
            execute(session_id.clone(), turn_id.clone()).await.unwrap()["status"],
            "submitted"
        );
    }
    assert!(execute("another-session".into(), turn_id.clone())
        .await
        .is_err());
    assert!(execute(session_id.clone(), "another-turn".into())
        .await
        .is_err());
    ok(
        &fixture.server,
        "turn/interrupt",
        json!({"threadId":thread,"turnId":turn}),
    )
    .await;
    assert!(execute(session_id, turn_id).await.is_err());
}

#[tokio::test]
async fn uninstalled_adapters_are_visible_and_setup_never_synthesizes_a_grant() {
    let fixture = Fixture::new(false).await;
    let status = ok(&fixture.server, "computerUse/status", json!({})).await;
    let adapters = status["adapters"].as_array().unwrap();
    assert_eq!(adapters.len(), 3);
    assert!(adapters.iter().all(|a| a["readiness"] == "not_installed"));
    for adapter in ["native", "chrome", "office"] {
        let setup = ok(
            &fixture.server,
            "computerUse/setup",
            json!({"adapter":adapter}),
        )
        .await;
        assert_eq!(setup["accepted"], false);
        assert!(setup.get("grant").is_none());
    }
}

#[tokio::test]
async fn native_lease_requires_a_live_canonical_turn_and_interrupt_releases_control() {
    let fixture = Fixture::new(true).await;
    let grant = fixture.grant().await;
    let mut params = json!({"adapter":"native","target":target(),"capability":"click",
        "grantId":grant["id"],"threadId":"missing","turnId":"missing"});
    assert!(
        call(&fixture.server, "computerUse/lease/acquire", params.clone())
            .await
            .get("error")
            .is_some()
    );
    let (thread, turn) = fixture.turn().await;
    params["threadId"] = thread.clone();
    params["turnId"] = turn.clone();
    let lease = ok(&fixture.server, "computerUse/lease/acquire", params.clone()).await;
    assert!(
        call(&fixture.server, "computerUse/lease/acquire", params.clone())
            .await
            .get("error")
            .is_some()
    );
    ok(
        &fixture.server,
        "turn/interrupt",
        json!({"threadId":thread,"turnId":turn}),
    )
    .await;
    assert_eq!(
        ok(
            &fixture.server,
            "computerUse/lease/release",
            json!({"leaseId":lease["leaseId"]})
        )
        .await["released"],
        false
    );
    assert!(call(&fixture.server, "computerUse/lease/acquire", params)
        .await
        .get("error")
        .is_some());
}

#[tokio::test]
async fn live_admin_change_and_revocation_invalidate_existing_grants() {
    let fixture = Fixture::new(true).await;
    let grant = fixture.grant().await;
    let revoke = ok(
        &fixture.server,
        "computerUse/revoke",
        json!({"grantId":grant["id"]}),
    )
    .await;
    assert_eq!(revoke["revoked"], true);
    assert!(revoke["epoch"].as_u64().unwrap() > grant["epoch"].as_u64().unwrap());
    std::fs::write(
        &fixture.requirements,
        "allow_browser_and_computer_use = false",
    )
    .unwrap();
    let status = ok(
        &fixture.server,
        "computerUse/status",
        json!({"adapter":"native"}),
    )
    .await;
    assert_eq!(status["adapters"][0]["readiness"], "blocked");
    assert!(ok(
        &fixture.server,
        "computerUse/setup",
        json!({"adapter":"native","target":target()})
    )
    .await
    .get("grant")
    .is_none());
    std::fs::write(
        &fixture.requirements,
        "allow_browser_and_computer_use = 'invalid'",
    )
    .unwrap();
    assert!(call(&fixture.server, "computerUse/status", json!({}))
        .await
        .get("error")
        .is_some());
}

#[tokio::test]
async fn rpc_cannot_supply_consent_or_adapter_readiness_and_identity_is_exact() {
    let fixture = Fixture::new(true).await;
    for params in [
        json!({"adapter":"native","approved":true}),
        json!({"adapter":"native","readiness":"ready"}),
        json!({"adapter":"native","grantId":"forged"}),
    ] {
        assert!(call(&fixture.server, "computerUse/setup", params)
            .await
            .get("error")
            .is_some());
    }
    let mut forged = serde_json::to_value(target()).unwrap();
    forged["processId"] = json!(99);
    assert!(call(
        &fixture.server,
        "computerUse/setup",
        json!({"adapter":"native","target":forged})
    )
    .await
    .get("error")
    .is_some());
    // Same stable app/process/window, changed display label: still the same target.
    let mut labelled = serde_json::to_value(target()).unwrap();
    labelled["title"] = json!("renamed document");
    assert!(ok(
        &fixture.server,
        "computerUse/setup",
        json!({"adapter":"native","target":labelled})
    )
    .await
    .get("grant")
    .is_some());
}

#[tokio::test]
async fn config_write_revokes_an_active_lease_before_the_next_action() {
    let fixture = Fixture::new(true).await;
    let grant = fixture.grant().await;
    let (thread, turn) = fixture.turn().await;
    let lease = ok(
        &fixture.server,
        "computerUse/lease/acquire",
        json!({
            "adapter":"native","target":target(),"capability":"click","grantId":grant["id"],
            "threadId":thread,"turnId":turn
        }),
    )
    .await;
    ok(
        &fixture.server,
        "config/value/write",
        json!({
            "keyPath":"computer_use.default_app_access","value":"deny","mergeStrategy":"replace"
        }),
    )
    .await;
    assert_eq!(
        ok(
            &fixture.server,
            "computerUse/lease/release",
            json!({"leaseId":lease["leaseId"]})
        )
        .await["released"],
        false
    );
    assert!(ok(
        &fixture.server,
        "computerUse/setup",
        json!({"adapter":"native","target":target()})
    )
    .await
    .get("grant")
    .is_none());
    ok(
        &fixture.server,
        "turn/interrupt",
        json!({"threadId":thread,"turnId":turn}),
    )
    .await;
}
