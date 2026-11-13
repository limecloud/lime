use super::*;

pub(super) fn is_installed_skill(skill: &Value, root: &std::path::Path) -> bool {
    skill["name"] == "research"
        && skill["path"].as_str().is_some_and(|path| {
            std::path::Path::new(path).starts_with(root.canonicalize().unwrap())
        })
}

pub(super) fn configure(f: &Fixture) -> Vec<Value> {
    let artifacts: Vec<Value> = serde_json::from_str(include_str!(
        "../../src/market/testdata/cloud-market-runtime.json"
    ))
    .unwrap();
    dependencies::configure_artifacts(f, &artifacts);
    artifacts.into_iter().map(|a| a["item"].clone()).collect()
}

pub(super) fn install_params(item: &Value) -> Value {
    json!({"itemId":item["id"],"kind":item["kind"],"release":reference(&item["release"]),"installAttemptId":"standalone-install-attempt"})
}

pub(super) async fn install_runtime_resources(f: &Fixture, server: &app_server::AppServer) {
    let items = configure(f);
    for index in [0, 2] {
        rpc(server, "market/install", install_params(&items[index])).await;
    }
}

#[tokio::test]
async fn independent_types_keep_identity_and_survive_cold_start_without_becoming_plugins() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = configure(&f);
    let app = server(temp.path()).await;
    login(&f, &app).await;
    for item in &items[..3] {
        let installed = rpc(&app, "market/install", install_params(item)).await;
        assert_eq!(installed["resource"]["kind"], item["kind"]);
        assert_eq!(
            installed["resource"]["release"],
            reference(&item["release"])
        );
        assert_eq!(installed["resource"]["installation"]["enabled"], true);
    }
    let plugins = rpc(&app, "plugin/installed", json!({})).await;
    assert!(plugins["marketplaces"].as_array().unwrap().is_empty());
    let cold = issuer::server(temp.path()).await;
    let installed = rpc(&cold, "market/installed", json!({})).await;
    assert_eq!(installed["resources"].as_array().unwrap().len(), 3);
    assert_eq!(installed["errors"], json!([]));
    let skills = rpc(
        &cold,
        "skills/list",
        json!({"cwds":[temp.path()],"forceReload":true}),
    )
    .await;
    assert_eq!(
        skills["data"][0]["skills"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| is_installed_skill(s, temp.path()))
            .count(),
        1
    );
    let status = rpc(&cold, "mcpServerStatus/list", json!({})).await;
    let servers = status["data"].as_array().unwrap();
    assert_eq!(servers.len(), 2);
    assert!(servers.iter().all(|s| s["pluginId"].is_null()));
    for item in &items[..3] {
        let mut params = json!({"itemId":item["id"],"kind":item["kind"],"enabled":false});
        rpc(&cold, "market/enabled/set", params.clone()).await;
        params["enabled"] = json!(true);
        rpc(&cold, "market/enabled/set", params).await;
        rpc(
            &cold,
            "market/uninstall",
            json!({"itemId":item["id"],"kind":item["kind"]}),
        )
        .await;
    }
    assert_eq!(
        rpc(&cold, "market/installed", json!({})).await["resources"],
        json!([])
    );
    assert_eq!(f.count("/market/acquisitions"), 3);
}

#[tokio::test]
async fn catalog_pages_and_exact_reads_keep_types_and_installation_separate() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = configure(&f);
    f.respond(
        "/api/v1/client/market/items",
        200,
        json!({"items":[items[0]],"nextCursor":"page-two"}),
    );
    let app = server(temp.path()).await;
    login(&f, &app).await;
    let page = rpc(&app, "market/list", json!({"kind":"skill","limit":1})).await;
    assert_eq!(page["resources"].as_array().unwrap().len(), 1);
    assert_eq!(page["nextCursor"], "page-two");
    assert!(page["resources"][0]["installation"].is_null());
    assert_eq!(
        f.state
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|(p, _, _)| p.starts_with("/api/v1/client/market/items?"))
            .count(),
        1
    );
    let read = rpc(
        &app,
        "market/read",
        json!({"kind":"mcp","itemId":items[1]["id"]}),
    )
    .await;
    assert_eq!(read["resource"]["mcp"]["authentication"], "oauth2");
    assert_eq!(read["resource"]["mcp"]["scopes"], json!(["research:read"]));
    let mismatch = raw(
        &app,
        "market/read",
        json!({"kind":"skill","itemId":items[1]["id"]}),
    )
    .await;
    assert!(mismatch.get("error").is_some());
    assert_eq!(f.count("/market/acquisitions"), 0);
}

#[tokio::test]
async fn release_mismatch_never_acquires_and_other_accounts_do_not_see_installations() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = configure(&f);
    let app = server(temp.path()).await;
    login(&f, &app).await;
    let mut invalid = install_params(&items[0]);
    invalid["release"]["archiveSha256"] = json!("0".repeat(64));
    assert!(raw(&app, "market/install", invalid)
        .await
        .get("error")
        .is_some());
    assert_eq!(f.count("/market/acquisitions"), 0);
    rpc(&app, "market/install", install_params(&items[0])).await;
    rpc(&app, "account/logout", json!({})).await;
    assert_eq!(
        rpc(&app, "market/installed", json!({})).await["resources"],
        json!([])
    );
    f.state.lock().unwrap().user = "another-product-user".into();
    login(&f, &app).await;
    assert_eq!(
        rpc(&app, "market/installed", json!({})).await["resources"],
        json!([])
    );
    let skills = rpc(&app, "skills/list", json!({"cwds":[temp.path()]})).await;
    assert!(!skills["data"][0]["skills"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| is_installed_skill(s, temp.path())));
}

#[tokio::test]
async fn unknown_installation_resumes_original_selection_and_keys_after_restart() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = configure(&f);
    let app = server(temp.path()).await;
    login(&f, &app).await;
    let acquire_path = "/api/v1/client/market/acquisitions#rel_research_skill";
    let acquired = json!({"id":"acq_skill_main","releaseId":"rel_research_skill","status":"active","revision":1});
    f.respond(acquire_path, 503, json!({"error":"outcome_unknown"}));
    assert!(raw(&app, "market/install", install_params(&items[0]))
        .await
        .get("error")
        .is_some());
    assert_eq!(
        rpc(&app, "market/installed", json!({})).await["resources"],
        json!([])
    );
    f.respond(
        &dependencies::operation_path(
            "standalone-install-attempt",
            "item_research_skill",
            "acquire",
        ),
        200,
        json!({"result":acquired}),
    );
    let mut changed = items[0].clone();
    changed["revision"] = json!(8);
    f.respond(
        "/api/v1/client/market/items/item_research_skill",
        200,
        changed,
    );
    let mut retry = install_params(&items[0]);
    retry["installAttemptId"] = json!("new-click-must-not-replace-original");
    let cold = issuer::server(temp.path()).await;
    rpc(&cold, "market/install", retry).await;
    let state = f.state.lock().unwrap();
    let writes = state
        .calls
        .iter()
        .filter(|(p, _, _)| p.ends_with("/market/acquisitions"))
        .collect::<Vec<_>>();
    assert_eq!(writes.len(), 1);
    assert_eq!(writes[0].1["expectedItemRevision"], 1);
}

#[tokio::test]
async fn failed_update_preserves_the_previous_resource() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = configure(&f);
    let app = server(temp.path()).await;
    login(&f, &app).await;
    rpc(&app, "market/install", install_params(&items[0])).await;
    let mut updated = items[0].clone();
    updated["release"]["id"] = json!("rel_skill_update");
    updated["publishedReleaseId"] = json!("rel_skill_update");
    updated["revision"] = json!(2);
    f.respond(
        "/api/v1/client/market/items/item_research_skill",
        200,
        updated.clone(),
    );
    f.respond(
        "/api/v1/client/market/releases/rel_skill_update",
        200,
        updated["release"].clone(),
    );
    f.respond(
        "/api/v1/client/market/acquisitions#rel_skill_update",
        200,
        json!({"id":"acq_update","releaseId":"rel_skill_update","status":"active","revision":1}),
    );
    f.respond(
        "/api/v1/client/market/acquisitions/acq_update/download-tickets",
        404,
        json!({"error":"not_found"}),
    );
    let mut params = install_params(&updated);
    params["installAttemptId"] = json!("standalone-update-attempt");
    assert!(raw(&app, "market/install", params)
        .await
        .get("error")
        .is_some());
    let installed = rpc(&app, "market/installed", json!({})).await;
    assert_eq!(
        installed["resources"][0]["installation"]["release"],
        reference(&items[0]["release"])
    );
    assert_eq!(installed["resources"][0]["installation"]["enabled"], true);
}
