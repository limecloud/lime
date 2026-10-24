use super::*;
use agent_protocol::WebSearchMode;

#[tokio::test]
async fn web_search_config_snapshots_validation_and_cold_restore_share_one_owner() {
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("config.yaml");
    std::fs::write(&config, "server:\n  api_key: search-fixture\n").unwrap();
    let agent_root = temp.path().join("agent");
    let store = Arc::new(
        ProjectionStore::initialize_with_agent_root(
            agent_root.join("projection.sqlite"),
            &agent_root,
        )
        .unwrap(),
    );
    let (tx, mut captures) = mpsc::unbounded_channel();
    let make = || {
        AppServer::with_runtime(
            RuntimeCore::with_backend(Arc::new(Capture(tx.clone())))
                .with_projection_store(store.clone())
                .with_app_config_path(config.clone()),
        )
    };
    let server = make();
    initialize(&server).await;
    let initial = call(&server, "config/read", json!({"includeLayers":true})).await;
    let default = start(&server, json!({})).await;
    assert_eq!(default["extra"]["webSearchMode"], "cached");
    let unrestricted = start(&server, json!({"sandbox":"danger-full-access"})).await;
    assert_eq!(unrestricted["extra"]["webSearchMode"], "live");
    let mut saved = initial.clone();
    for (value, mode) in [
        ("disabled", WebSearchMode::Disabled),
        ("cached", WebSearchMode::Cached),
        ("indexed", WebSearchMode::Indexed),
        ("live", WebSearchMode::Live),
    ] {
        saved = call(
            &server,
            "config/value/write",
            json!({"keyPath":"web_search","value":value,"mergeStrategy":"replace"}),
        )
        .await;
        let thread = start(&server, json!({})).await;
        assert_eq!(thread["extra"]["webSearchMode"], value);
        turn(&server, &thread["id"], None).await;
        assert_eq!(captures.recv().await.unwrap().web_search_mode, Some(mode));
    }
    let before = std::fs::read(&config).unwrap();
    for value in [json!(true), json!("auto"), json!({"engine":"google"})] {
        let response = raw(
            &server,
            "config/batchWrite",
            json!({"edits":[
                {"keyPath":"language","value":"ja-JP","mergeStrategy":"replace"},
                {"keyPath":"web_search","value":value,"mergeStrategy":"replace"}
            ]}),
        )
        .await;
        assert!(response.get("error").is_some());
        assert_eq!(std::fs::read(&config).unwrap(), before);
    }
    let stale = raw(&server,"config/value/write",json!({"keyPath":"web_search","value":"disabled","mergeStrategy":"replace","expectedVersion":initial["layers"][0]["version"]})).await;
    assert!(stale.get("error").is_some());
    assert_eq!(std::fs::read(&config).unwrap(), before);
    turn(&server, &default["id"], None).await;
    assert_eq!(
        captures.recv().await.unwrap().web_search_mode,
        Some(WebSearchMode::Cached)
    );
    drop(server);
    let restored = make();
    initialize(&restored).await;
    call(
        &restored,
        "thread/resume",
        json!({"threadId":default["id"]}),
    )
    .await;
    turn(&restored, &default["id"], None).await;
    assert_eq!(
        captures.recv().await.unwrap().web_search_mode,
        Some(WebSearchMode::Cached)
    );
    call(&restored,"config/value/write",json!({"keyPath":"web_search","value":null,"mergeStrategy":"replace","expectedVersion":saved["version"]})).await;
    assert_eq!(
        start(&restored, json!({"sandbox":"danger-full-access"})).await["extra"]["webSearchMode"],
        "live"
    );
    call(&restored,"config/value/write",json!({"keyPath":"default_permissions","value":":danger-full-access","mergeStrategy":"replace"})).await;
    let projected = call(&restored, "config/read", json!({"includeLayers":true})).await;
    assert_eq!(projected["config"]["web_search"], "live");
    assert!(projected["layers"][0]["config"]["web_search"].is_null());
    assert_eq!(
        start(&restored, json!({})).await["extra"]["webSearchMode"],
        "live"
    );
    call(&restored,"config/batchWrite",json!({"edits":[
        {"keyPath":"permissions.custom.extends","value":":danger-full-access","mergeStrategy":"upsert"},
        {"keyPath":"default_permissions","value":"custom","mergeStrategy":"replace"}
    ]})).await;
    assert_eq!(
        call(&restored, "config/read", json!({})).await["config"]["web_search"],
        "live"
    );
}
