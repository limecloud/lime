use super::*;

#[tokio::test]
async fn permissions_are_new_thread_snapshots_and_explicit_overrides_survive_cold_restore() {
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("config.yaml");
    std::fs::write(&config, "server:\n  api_key: permission-fixture-key\n").unwrap();
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
    let make = || {
        AppServer::with_runtime(
            RuntimeCore::with_backend(Arc::new(Capture(tx.clone())))
                .with_projection_store(store.clone())
                .with_event_log_writer(log.clone())
                .with_app_config_path(config.clone()),
        )
    };
    let server = make();
    initialize(&server).await;
    let initial = call(&server, "config/read", json!({"includeLayers":true})).await;
    assert_eq!(initial["config"]["approval_policy"], "on-request");
    assert_eq!(initial["config"]["sandbox_mode"], "read-only");
    assert_eq!(
        initial["config"]["sandbox_workspace_write"]["network_access"],
        false
    );
    let saved = call(&server, "config/batchWrite", json!({"expectedVersion":initial["layers"][0]["version"],"edits":[
        {"keyPath":"approval_policy","value":"never","mergeStrategy":"replace"},
        {"keyPath":"sandbox_mode","value":"workspace-write","mergeStrategy":"replace"},
        {"keyPath":"sandbox_workspace_write.network_access","value":true,"mergeStrategy":"upsert"}
    ]})).await;
    let first = start(&server, json!({})).await;
    assert_eq!(first["extra"]["approvalPolicy"], "never");
    assert_eq!(first["extra"]["sandboxPolicy"], "workspace-write");
    assert_eq!(first["extra"]["sandboxNetworkAccess"], true);
    let bytes = std::fs::read(&config).unwrap();
    for params in [
        json!({"keyPath":"approval_policy","value":"always","mergeStrategy":"replace"}),
        json!({"keyPath":"sandbox_mode","value":"external","mergeStrategy":"replace"}),
        json!({"keyPath":"sandbox_workspace_write.network_access","value":"true","mergeStrategy":"upsert"}),
        json!({"keyPath":"sandbox_mode","value":"read-only","mergeStrategy":"replace","expectedVersion":initial["layers"][0]["version"]}),
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
        json!({"expectedVersion":saved["version"],"edits":[
            {"keyPath":"approval_policy","value":"on-request","mergeStrategy":"replace"},
            {"keyPath":"sandbox_mode","value":"read-only","mergeStrategy":"replace"},
            {"keyPath":"default_permissions","value":":read-only","mergeStrategy":"upsert"}
        ]}),
    )
    .await;
    turn(&server, &first["id"], None).await;
    let request = captures.recv().await.unwrap();
    assert_eq!(request.approval_policy.as_deref(), Some("never"));
    assert_eq!(request.sandbox_policy.as_deref(), Some("workspace-write"));
    assert_eq!(request.sandbox_network_access, Some(true));
    let inherited = start(&server, json!({})).await;
    assert_eq!(inherited["extra"]["sandboxPolicy"], "read-only");
    assert_eq!(inherited["extra"]["sandboxNetworkAccess"], false);
    let explicit = start(&server, json!({"sandbox":"workspace-write"})).await;
    assert_eq!(explicit["extra"]["sandboxPolicy"], "workspace-write");
    assert!(explicit["extra"]["activePermissionProfile"].is_null());
    assert_eq!(explicit["extra"]["sandboxNetworkAccess"], false);
    let config_override = start(&server,json!({"config":{"sandbox_mode":"workspace-write","sandbox_workspace_write":{"network_access":true}}})).await;
    assert!(config_override["extra"]["activePermissionProfile"].is_null());
    assert_eq!(config_override["extra"]["sandboxNetworkAccess"], true);
    let rejected = raw(&server,"thread/start",json!({"model":"fixture-model","modelProvider":"fixture-provider","permissions":":workspace","sandbox":"read-only"})).await;
    assert!(rejected.get("error").is_some());

    run_override(
        &server,
        &first["id"],
        json!({"sandboxPolicy":"read-only","approvalPolicy":"on-request"}),
    )
    .await;
    let request = captures.recv().await.unwrap();
    assert_eq!(request.sandbox_policy.as_deref(), Some("read-only"));
    assert_eq!(request.sandbox_network_access, Some(false));
    drop(server);
    let restored = make();
    initialize(&restored).await;
    call(&restored, "thread/resume", json!({"threadId":first["id"]})).await;
    turn(&restored, &first["id"], None).await;
    let request = captures.recv().await.unwrap();
    assert_eq!(request.approval_policy.as_deref(), Some("on-request"));
    assert_eq!(request.sandbox_policy.as_deref(), Some("read-only"));
    assert_eq!(request.sandbox_network_access, Some(false));
    call(
        &restored,
        "thread/resume",
        json!({"threadId":config_override["id"]}),
    )
    .await;
    turn(&restored, &config_override["id"], None).await;
    let request = captures.recv().await.unwrap();
    assert_eq!(request.sandbox_policy.as_deref(), Some("workspace-write"));
    assert_eq!(request.sandbox_network_access, Some(true));
}

async fn run_override(server: &AppServer, thread: &Value, overrides: Value) {
    let mut events = server.subscribe_outbound_messages();
    let mut params =
        json!({"threadId":thread,"input":[{"type":"text","text":"permission fixture"}]});
    params
        .as_object_mut()
        .unwrap()
        .extend(overrides.as_object().unwrap().clone());
    let started = call(server, "turn/start", params).await;
    timeout(Duration::from_secs(10), async {
        loop {
            let event = serde_json::to_value(events.recv().await.unwrap()).unwrap();
            if event["method"] == "turn/completed"
                && event["params"]["turn"]["id"] == started["turn"]["id"]
            {
                assert_eq!(event["params"]["turn"]["status"], "completed");
                break;
            }
        }
    })
    .await
    .unwrap();
}
