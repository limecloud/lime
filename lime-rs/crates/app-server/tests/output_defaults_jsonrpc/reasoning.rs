use super::*;

#[tokio::test]
async fn effort_defaults_freeze_new_threads_without_rewriting_existing_or_restored_threads() {
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("config.yaml");
    std::fs::write(
        &config,
        "server:\n  api_key: effort-test-only\nmodel_reasoning_effort: ultra\n",
    )
    .unwrap();
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
    let first = call(
        &server,
        "thread/start",
        json!({"model":"fixture-model","modelProvider":"fixture-provider"}),
    )
    .await;
    assert_eq!(first["reasoningEffort"], "ultra");
    assert_eq!(first["thread"]["extra"]["reasoningEffort"], "ultra");
    call(
        &server,
        "config/value/write",
        json!({
            "keyPath":"model_reasoning_effort","value":"medium","mergeStrategy":"replace"
        }),
    )
    .await;
    let next = start(&server, json!({})).await;
    let explicit = start(&server, json!({"config":{"model_reasoning_effort":"max"}})).await;
    let cleared = start(&server, json!({"config":{"model_reasoning_effort":null}})).await;
    assert_eq!(next["extra"]["reasoningEffort"], "medium");
    assert_eq!(explicit["extra"]["reasoningEffort"], "max");
    assert!(cleared["extra"]["reasoningEffort"].is_null());
    for (thread, effort) in [
        (&first["thread"], Some("ultra")),
        (&next, Some("medium")),
        (&explicit, Some("max")),
        (&cleared, None),
    ] {
        turn(&server, &thread["id"], None).await;
        let request = timeout(Duration::from_secs(5), captures.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(request.reasoning_effort.as_deref(), effort);
    }
    let bytes = std::fs::read(&config).unwrap();
    for value in [json!("extreme"), json!(true), json!(5)] {
        assert!(raw(
            &server,
            "config/value/write",
            json!({
                "keyPath":"model_reasoning_effort","value":value,"mergeStrategy":"replace"
            })
        )
        .await
        .get("error")
        .is_some());
        assert_eq!(std::fs::read(&config).unwrap(), bytes);
    }
    assert!(raw(
        &server,
        "thread/start",
        json!({"config":{"model_reasoning_effort":"extreme"}})
    )
    .await
    .get("error")
    .is_some());
    drop(server);
    let server = make_server();
    initialize(&server).await;
    let restored = call(
        &server,
        "thread/resume",
        json!({"threadId":first["thread"]["id"]}),
    )
    .await;
    assert_eq!(restored["reasoningEffort"], "ultra");
    turn(&server, &first["thread"]["id"], None).await;
    let request = timeout(Duration::from_secs(5), captures.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(request.reasoning_effort.as_deref(), Some("ultra"));
    let after_restart = start(&server, json!({})).await;
    assert_eq!(after_restart["extra"]["reasoningEffort"], "medium");
    call(
        &server,
        "config/value/write",
        json!({
            "keyPath":"model_reasoning_effort","value":null,"mergeStrategy":"replace"
        }),
    )
    .await;
    let read = call(&server, "config/read", json!({})).await;
    assert!(read["config"].get("model_reasoning_effort").is_none());
    let unset = start(&server, json!({})).await;
    assert!(unset["extra"]["reasoningEffort"].is_null());
    assert_eq!(
        call(
            &server,
            "thread/read",
            json!({"threadId":first["thread"]["id"]})
        )
        .await["thread"]["extra"]["reasoningEffort"],
        "ultra"
    );
}
