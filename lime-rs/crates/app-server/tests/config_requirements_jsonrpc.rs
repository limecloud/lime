//! Administrator requirements must hold when callers bypass the settings UI.
use app_server::{
    ActionRespondRequest, AppServer, CancelExecutionRequest, ExecutionBackend, ExecutionRequest,
    ProjectionStore, RuntimeCore, RuntimeCoreError, RuntimeEvent, RuntimeEventSink,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
use tempfile::TempDir;

const POLICY: &str = "allowed_approval_policies = ['on-request']\nallowed_sandbox_modes = ['read-only', 'workspace-write']\nallowed_web_search_modes = ['cached']\n";

struct Capture(Arc<AtomicUsize>);
#[async_trait]
impl ExecutionBackend for Capture {
    async fn start_turn(
        &self,
        _: ExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        self.0.fetch_add(1, Ordering::SeqCst);
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

struct Fixture {
    temp: TempDir,
    config: PathBuf,
    policy: PathBuf,
    calls: Arc<AtomicUsize>,
    store: Arc<ProjectionStore>,
}
impl Fixture {
    fn new() -> Self {
        let temp = TempDir::new().unwrap();
        let config = temp.path().join("config.yaml");
        let policy = temp.path().join("system-requirements.toml");
        std::fs::write(&config, "server:\n  api_key: test-only\napproval_policy: never\nsandbox_mode: danger-full-access\nweb_search: live\n").unwrap();
        let agent_root = temp.path().join("agent");
        let store = Arc::new(
            ProjectionStore::initialize_with_agent_root(
                agent_root.join("projection.sqlite"),
                &agent_root,
            )
            .unwrap(),
        );
        Self {
            temp,
            config,
            policy,
            calls: Arc::new(AtomicUsize::new(0)),
            store,
        }
    }
    async fn server(&self) -> (AppServer, RuntimeCore) {
        let runtime = RuntimeCore::with_backend(Arc::new(Capture(self.calls.clone())))
            .with_app_config_path(self.config.clone())
            .with_requirements_path(self.policy.clone())
            .with_projection_store(self.store.clone());
        let server = AppServer::with_runtime(runtime.clone());
        call(&server, "initialize", json!({"clientInfo":{"name":"requirements-fixture","version":"1"},"capabilities":{"experimentalApi":true}})).await;
        server
            .handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized"}).to_string())
            .await
            .unwrap();
        (server, runtime)
    }
}

#[tokio::test]
async fn requirements_are_independent_and_cannot_be_supplied_by_rpc_or_user_config() {
    let fixture = Fixture::new();
    // A lookalike beside the user file is not the host-injected system policy source.
    std::fs::write(fixture.temp.path().join("requirements.toml"), POLICY).unwrap();
    let (server, _) = fixture.server().await;
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await,
        json!({"requirements":null})
    );
    let profiles = call(&server, "permissionProfile/list", json!({})).await;
    assert_eq!(
        profiles["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|profile| profile["id"] == ":danger-full-access")
            .unwrap()["allowed"],
        true
    );
    let response = raw(
        &server,
        "configRequirements/read",
        json!({"path":fixture.policy}),
    )
    .await;
    assert!(response.get("error").is_some(), "{response}");
    std::fs::write(&fixture.policy, POLICY).unwrap();
    let profiles = call(&server, "permissionProfile/list", json!({})).await;
    assert_eq!(
        profiles["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|profile| profile["id"] == ":danger-full-access")
            .unwrap()["allowed"],
        false
    );
    let read = call(&server, "configRequirements/read", json!({})).await;
    assert_eq!(
        read["requirements"]["allowedApprovalPolicies"],
        json!(["on-request"])
    );
    assert_eq!(
        read["requirements"]["allowedWebSearchModes"],
        json!(["cached", "disabled"])
    );
    let before = std::fs::read(&fixture.config).unwrap();
    let read = call(&server, "config/read", json!({"includeLayers":true})).await;
    assert_eq!(read["config"]["approval_policy"], "on-request");
    assert_eq!(read["config"]["sandbox_mode"], "read-only");
    assert_eq!(read["config"]["web_search"], "disabled");
    assert_eq!(
        read["layers"][0]["config"]["sandbox_mode"],
        "danger-full-access"
    );
    assert_eq!(std::fs::read(&fixture.config).unwrap(), before);
}

#[tokio::test]
async fn user_project_and_atomic_batch_writes_cannot_exceed_requirements() {
    let fixture = Fixture::new();
    std::fs::write(&fixture.policy, POLICY).unwrap();
    let (server, _) = fixture.server().await;
    for (key, value) in [
        ("approval_policy", "never"),
        ("sandbox_mode", "danger-full-access"),
        ("web_search", "live"),
    ] {
        let before = std::fs::read(&fixture.config).unwrap();
        let response = raw(
            &server,
            "config/batchWrite",
            json!({"edits":[
                {"keyPath":"language","value":"ja-JP","mergeStrategy":"replace"},
                {"keyPath":key,"value":value,"mergeStrategy":"replace"}
            ]}),
        )
        .await;
        assert!(response.get("error").is_some(), "{response}");
        assert_eq!(
            response["error"]["data"]["config_write_error_code"],
            "configRequirementReadonly"
        );
        assert_eq!(std::fs::read(&fixture.config).unwrap(), before);
    }
    let folder = fixture.temp.path().join("project/.lime");
    std::fs::create_dir_all(&folder).unwrap();
    let project = folder.join("config.toml");
    std::fs::write(
        &project,
        "# preserve this file\nsandbox_mode = 'read-only'\n",
    )
    .unwrap();
    let before = std::fs::read(&project).unwrap();
    let response = raw(&server, "config/value/write", json!({"keyPath":"sandbox_mode","value":"danger-full-access","mergeStrategy":"replace","filePath":project})).await;
    assert_eq!(
        response["error"]["data"]["config_write_error_code"],
        "configRequirementReadonly"
    );
    assert_eq!(std::fs::read(&project).unwrap(), before);
    call(
        &server,
        "config/value/write",
        json!({"keyPath":"web_search","value":"disabled","mergeStrategy":"replace"}),
    )
    .await;
}

#[tokio::test]
async fn explicit_thread_settings_and_permission_profiles_are_rejected_before_persistence() {
    let fixture = Fixture::new();
    std::fs::write(&fixture.policy, POLICY).unwrap();
    let (server, _) = fixture.server().await;
    call(&server, "config/value/write", json!({"keyPath":"permissions.escape","value":{"extends":":danger-full-access"},"mergeStrategy":"upsert"})).await;
    let profiles = call(&server, "permissionProfile/list", json!({})).await;
    assert_eq!(
        profiles["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|profile| profile["id"] == "escape")
            .unwrap()["allowed"],
        false
    );
    for extra in [
        json!({"approvalPolicy":"never"}),
        json!({"sandbox":"danger-full-access"}),
        json!({"permissions":":danger-full-access"}),
        json!({"permissions":"escape"}),
        json!({"config":{"sandbox_mode":"danger-full-access"}}),
        json!({"config":{"web_search":"live"}}),
    ] {
        let mut params = start_params();
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let response = raw(&server, "thread/start", params).await;
        assert!(response.get("error").is_some(), "{extra}: {response}");
    }
    let thread = call(&server, "thread/start", start_params()).await["thread"]["id"].clone();
    let before = call(&server, "thread/read", json!({"threadId":thread})).await;
    for extra in [
        json!({"approvalPolicy":"never"}),
        json!({"sandboxPolicy":"danger-full-access"}),
        json!({"permissions":":danger-full-access"}),
        json!({"permissions":"escape"}),
    ] {
        let mut params = json!({"threadId":thread});
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let response = raw(&server, "thread/settings/update", params).await;
        assert!(response.get("error").is_some(), "{extra}: {response}");
    }
    assert_eq!(
        call(&server, "thread/read", json!({"threadId":thread})).await["thread"]["extra"],
        before["thread"]["extra"]
    );
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
    let mut events = server.subscribe_outbound_messages();
    let accepted = call(
        &server,
        "turn/start",
        json!({"threadId":thread,"input":[{"type":"text","text":"allowed by policy"}]}),
    )
    .await;
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let event = serde_json::to_value(events.recv().await.unwrap()).unwrap();
            if event["method"] == "turn/completed"
                && event["params"]["turn"]["id"] == accepted["turn"]["id"]
            {
                assert_eq!(event["params"]["turn"]["status"], "completed");
                break;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn changed_policy_rejects_old_threads_after_cold_restore_and_direct_runtime_overrides() {
    let fixture = Fixture::new();
    let (server, _) = fixture.server().await;
    let thread = call(&server, "thread/start", start_params()).await["thread"]["id"].clone();
    drop(server);
    std::fs::write(&fixture.policy, POLICY).unwrap();
    let (server, runtime) = fixture.server().await;
    call(&server, "thread/resume", json!({"threadId":thread})).await;
    let turn =
        json!({"threadId":thread,"input":[{"type":"text","text":"blocked by changed policy"}]});
    let rejected = raw(&server, "turn/start", turn.clone()).await;
    assert!(
        rejected["error"]["message"]
            .as_str()
            .is_some_and(|message| message.contains("Admin policy")),
        "{rejected}"
    );
    let direct: app_server_protocol::AgentSessionTurnStartParams = serde_json::from_value(json!({"sessionId":thread,"input":{"text":"direct override"},"runtimeOptions":{"runtimeRequest":{"sandboxPolicy":"danger-full-access","approvalPolicy":"never","webSearchMode":"live"}}})).unwrap();
    let Err(error) = runtime
        .start_turn(direct, app_server::RuntimeHostContext::default())
        .await
    else {
        panic!("RuntimeCore accepted a forbidden direct override");
    };
    assert!(error.to_string().contains("Admin policy"), "{error}");
    std::fs::write(&fixture.policy, "allowed_sandbox_modes = []").unwrap();
    assert!(raw(&server, "permissionProfile/list", json!({}))
        .await
        .get("error")
        .is_some());
    assert!(raw(&server, "configRequirements/read", json!({}))
        .await
        .get("error")
        .is_some());
    assert!(raw(&server, "config/read", json!({}))
        .await
        .get("error")
        .is_some());
    assert!(raw(&server, "turn/start", turn)
        .await
        .get("error")
        .is_some());
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
}

fn start_params() -> Value {
    json!({"model":"fixture-model","modelProvider":"fixture-provider"})
}
async fn call(server: &AppServer, method: &str, params: Value) -> Value {
    let response = raw(server, method, params).await;
    assert!(response.get("error").is_none(), "{method}: {response}");
    response["result"].clone()
}
async fn raw(server: &AppServer, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        )
        .await
        .unwrap();
    lines
        .into_iter()
        .map(|line| serde_json::from_str::<Value>(&line).unwrap())
        .find(|message| message["id"] == 1)
        .unwrap()
}
